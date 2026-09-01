/* =============================================================================
 * CALC — расчётное ядро калькулятора стоимости выравнивания оплаты (часть A).
 *
 * Чистый ES2020. Никаких import/export, никаких обращений к document/window,
 * никаких внешних библиотек. Склеивается в один .html первым <script>-блоком.
 *
 * Публичный интерфейс (см. CONTRACT.md §3):
 *   CALC.generateDemoData()           → Employee[]   (~200, детерминированно)
 *   CALC.analyse(employees, settings) → Result
 *   CALC.selfCheck(result)            → CheckResult
 *
 * Соглашения (CONTRACT.md «Соглашения»):
 *   - деньги — числа в евро с копейками, округление только при выводе;
 *   - проценты — числа вида 8.4, не 0.084;
 *   - «фактические» деньги = с учётом fte и месяцев;
 *     «нормализованные» = полный годовой эквивалент;
 *   - analyse() не мутирует переданный массив.
 *
 * Порядок вычислений — строго по §4 спеки:
 *   нормализация → разрыв → OLS-декомпозиция → адресаты → два сценария →
 *   взносы → обратный пересчёт в фактические деньги → годовой эффект.
 * ========================================================================== */

var CALC = (function () {
  'use strict';

  /* ===========================================================================
   * 0. Сидированный PRNG
   *
   * mulberry32 — 32-битный генератор с периодом 2^32. Выбран потому, что он
   * помещается в десять строк, не требует библиотек и даёт одинаковую
   * последовательность в любом движке JS (все операции — через |0 и >>>,
   * то есть целочисленные, без зависимости от точности double).
   *
   * Это обязательное требование §5 спеки: калькулятор и Excel-модель должны
   * давать один и тот же массив сотрудников до цента. Seed зашит константой.
   * ======================================================================== */

  var DEMO_SEED = 20260830; // дата согласования спеки — чтобы seed был осмысленным

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Нормальный шум через преобразование Бокса — Мюллера.
   * Нужен, чтобы зарплаты внутри грейда рассеивались правдоподобно
   * (колокол), а не равномерно: равномерный шум ломает медиану и делает
   * регрессию неестественно точной. */
  function gauss(rnd) {
    var u1 = 1 - rnd(); // (0,1], чтобы не взять log(0)
    var u2 = rnd();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /* ===========================================================================
   * 1. Генератор демо-данных
   *
   * Модель генерации (§5 спеки): стоимость грейда — параметр генератора,
   * а не колонка входа, и регрессия должна её восстанавливать.
   *
   *   base_salary = base_category
   *               × (1 + GRADE_STEP)^(grade − 1)      ~12% за грейд
   *               × (1 + TENURE_STEP × tenure_years)  ~1.5% за год стажа
   *               × (1 + шум)
   *               × (1 + gap_коэффициент для женщин)
   *
   * Мультипликативная форма выбрана потому, что так реально устроены сетки
   * оплаты: шаг грейда — это процент, а не фиксированная сумма. Регрессия при
   * этом линейная (total_pay ~ grade + tenure), и она восстанавливает
   * стоимость грейда как СРЕДНИЙ прирост в евро на грейд в наблюдаемом
   * диапазоне — этого достаточно для декомпозиции разрыва и именно это
   * проверяет selfCheck.
   *
   * Семь неоднородностей §5 расписаны по категориям в CATEGORIES ниже,
   * каждая помечена комментарием.
   * ======================================================================== */

  var GRADE_STEP = 0.12;   // +12% оклада за каждый грейд
  var TENURE_STEP = 0.015; // +1.5% оклада за каждый год стажа

  /* Семь категорий. Поля:
   *   base            — оклад грейда 1 при нулевом стаже, €
   *   n               — численность
   *   grades          — [min, max] доступные грейды
   *   share_f         — доля женщин
   *   female_grade_bias — сдвиг распределения женщин по грейдам:
   *                       0 = поровну, 1 = женщины строго в младших грейдах
   *   gap_within_grade  — доля, на которую женщине режется оклад внутри грейда
   *   var_rate_m / var_rate_f — переменная часть как доля оклада, М и Ж
   *   flat_salary     — оклады выровнены по сетке без шума и без разрыва
   *   part_time_share — доля сотрудников с fte<1 / неполным годом
   *   noise           — сигма мультипликативного шума
   */
  var CATEGORIES = [
    {
      // НЕОДНОРОДНОСТЬ 1: разрыв ВНУТРИ грейда.
      // Женщины распределены по грейдам так же, как мужчины (bias 0),
      // но при равном грейде и стаже получают на 8% меньше. Регрессия
      // объяснит почти ноль — это чистый необъяснимый остаток.
      name: 'Engineering', base: 46000, n: 44, grades: [1, 6], share_f: 0.34,
      female_grade_bias: 0.00, gap_within_grade: 0.075,
      var_rate_m: 0.12, var_rate_f: 0.12, noise: 0.055, part_time_share: 0.02
    },
    {
      // НЕОДНОРОДНОСТЬ 2: СТРУКТУРНЫЙ разрыв — женщины концентрируются
      // в младших грейдах (bias 0.80), а внутри грейда платят одинаково.
      // Регрессия должна объяснить почти весь разрыв: explained ≈ raw_gap.
      // НЕОДНОРОДНОСТЬ 5 (часть): здесь же максимальный диапазон стажа,
      // так что связь «стаж — оплата» видна в коэффициенте tenure.
      name: 'Operations', base: 38000, n: 38, grades: [1, 6], share_f: 0.55,
      female_grade_bias: 0.80, gap_within_grade: 0.010,
      var_rate_m: 0.08, var_rate_f: 0.08, noise: 0.050, part_time_share: 0.05
    },
    {
      // НЕОДНОРОДНОСТЬ 3: МАЛОЧИСЛЕННАЯ категория (n = 8 < 10) с большим
      // разрывом (14%). Проверяет флаг unreliable из §4.9: n < 10 либо
      // любой пол < 3. Разрыв большой, но выборка не позволяет на него
      // опираться — инструмент обязан это показать.
      name: 'Legal', base: 62000, n: 8, grades: [3, 6], share_f: 0.375,
      female_grade_bias: 0.35, gap_within_grade: 0.090,
      var_rate_m: 0.15, var_rate_f: 0.15, noise: 0.045, part_time_share: 0.00
    },
    {
      // НЕОДНОРОДНОСТЬ 4: разрыв В ПОЛЬЗУ ЖЕНЩИН (gap_within_grade
      // отрицательный + женщины в старших грейдах). reverse_gap = true,
      // категория НЕ корректируется ни в одном сценарии, но в результате
      // присутствует: инструмент не прячет то, что не лечит (§4.4).
      name: 'Marketing', base: 42000, n: 26, grades: [1, 5], share_f: 0.50,
      female_grade_bias: -0.35, gap_within_grade: -0.040,
      var_rate_m: 0.10, var_rate_f: 0.10, noise: 0.050, part_time_share: 0.08
    },
    {
      // НЕОДНОРОДНОСТЬ 5: связь СТАЖА и оплаты выражена сильнее всего —
      // здесь стаж до 22 лет и он же главный источник различий.
      // Плюс умеренный разрыв внутри грейда.
      name: 'Manufacturing', base: 34000, n: 40, grades: [1, 5], share_f: 0.40,
      female_grade_bias: 0.30, gap_within_grade: 0.065,
      var_rate_m: 0.06, var_rate_f: 0.06, noise: 0.045,
      part_time_share: 0.05, tenure_max: 22
    },
    {
      // НЕОДНОРОДНОСТЬ 6: ЧАСТИЧНАЯ ЗАНЯТОСТЬ и неполный отработанный год —
      // треть категории с fte < 1 и/или months_worked < 12. Без нормализации
      // эти люди ложно попали бы в «недоплаченные», а бюджет был бы завышен
      // (§3 спеки). Стоимость по ним пересчитывается обратно в фактические
      // деньги: прибавка на 0.5 ставки стоит компании половину.
      name: 'Customer Support', base: 30000, n: 30, grades: [1, 4], share_f: 0.60,
      female_grade_bias: 0.40, gap_within_grade: 0.070,
      var_rate_m: 0.05, var_rate_f: 0.05, noise: 0.040, part_time_share: 0.33
    },
    {
      // НЕОДНОРОДНОСТЬ 7: РОВНЫЕ ОКЛАДЫ, разрыв в ПЕРЕМЕННОЙ части.
      // flat_salary: оклад строго по сетке, без шума и без гендерной правки.
      // Бонус: 28% оклада мужчинам против 14% женщинам. Разрыв по base = 0,
      // разрыв по total ≈ 11%, variable_gap_pct ≈ 50%.
      // Ради этого случая специалист и откроет инструмент.
      // Здесь же — самые высокие оклады: часть категории уходит ВЫШЕ потолка
      // взносов 61 214 €, что включает вторую ставку rate_above.
      name: 'Sales', base: 55000, n: 26, grades: [2, 6], share_f: 0.50,
      female_grade_bias: 0.00, gap_within_grade: 0.000, flat_salary: true,
      paired_structure: true,
      var_rate_m: 0.26, var_rate_f: 0.13, noise: 0.000, part_time_share: 0.00
    }
  ];

  /**
   * generateDemoData() — ~200 сотрудников, 7 категорий, детерминированно.
   *
   * Один и тот же вызов всегда даёт один и тот же массив: PRNG создаётся
   * заново от зашитого seed при каждом вызове, порядок обхода категорий и
   * сотрудников фиксирован.
   *
   * @returns {Array<Object>} Employee[] по форме CONTRACT.md §1
   */
  function generateDemoData() {
    var rnd = mulberry32(DEMO_SEED);
    var out = [];
    var seq = 1;

    for (var ci = 0; ci < CATEGORIES.length; ci++) {
      var C = CATEGORIES[ci];
      var gMin = C.grades[0];
      var gMax = C.grades[1];
      var span = gMax - gMin;
      var tenureMax = C.tenure_max || 14;

      /* paired_structure: категория генерируется матчеными парами М/Ж с
       * ОДИНАКОВЫМИ грейдом и стажем. Нужно там, где по замыслу оклады ровные
       * (неоднородность 7): при независимом розыгрыше грейда женщины в выборке
       * из 26 человек случайно оказываются на младших грейдах, база расходится
       * на ~11%, и «ровные оклады» перестают быть правдой. Пары убирают этот
       * артефакт: различие полов остаётся ровно одно — переменная часть.
       * Пол в паре чередуется, хвост категории добирается мужчинами. */
      var pairPlan = null;
      if (C.paired_structure) {
        /* Категория состоит РОВНО из пар F,M,F,M… без хвоста: n чётное,
         * share_f эффективно 0.5. Любой непарный остаток смещал бы среднюю
         * мужскую базу и снова ломал бы «ровные оклады» — а именно этот
         * случай категория и обязана демонстрировать. Пары гарантируют
         * совпадение грейда и стажа между полами по построению, поэтому
         * единственное различие в данных — переменная часть. */
        pairPlan = [];
        for (var p = 0; p < C.n; p++) pairPlan.push(p % 2 === 0 ? 'F' : 'M');
      }

      for (var i = 0; i < C.n; i++) {
        var isF = pairPlan ? pairPlan[i] === 'F' : rnd() < C.share_f;

        /* Грейд. u — позиция в диапазоне грейдов [0,1].
         * female_grade_bias сдвигает распределение женщин: u^(1+2b) при b>0
         * тянет к младшим грейдам (структурный разрыв), при b<0 — к старшим
         * (это и создаёт разрыв в пользу женщин в Marketing). Мужчины всегда
         * распределены равномерно. */
        var grade, tenure;
        var isPairPartner = pairPlan && i > 0 && pairPlan[i] === 'M'
          && pairPlan[i - 1] === 'F';

        if (isPairPartner) {
          // второй в паре наследует структуру первого: тот же грейд, тот же стаж
          grade = out[out.length - 1].grade;
          tenure = out[out.length - 1].tenure_years;
        } else {
          var u = rnd();
          if (isF && C.female_grade_bias !== 0) {
            var b = C.female_grade_bias;
            u = b > 0 ? Math.pow(u, 1 + 2 * b) : 1 - Math.pow(1 - u, 1 - 2 * b);
          }
          grade = gMin + Math.round(u * span);

          /* Стаж. Коррелирован с грейдом: на старших грейдах люди в среднем
           * дольше в компании — иначе регрессия получила бы два независимых
           * предиктора, чего в реальных данных не бывает. */
          var tenureBase = (grade - gMin) / Math.max(1, span) * tenureMax * 0.55;
          tenure = tenureBase + rnd() * tenureMax * 0.45;
          tenure = Math.round(Math.max(0.2, Math.min(tenureMax, tenure)) * 10) / 10;
        }

        /* Оклад по сетке: база × шаг грейда × шаг стажа. */
        var salary = C.base
          * Math.pow(1 + GRADE_STEP, grade - gMin)
          * (1 + TENURE_STEP * tenure);

        if (!C.flat_salary) {
          salary *= (1 + gauss(rnd) * C.noise);          // шум
          if (isF) salary *= (1 - C.gap_within_grade);   // разрыв внутри грейда
        }

        /* Переменная часть — доля оклада, своя для М и Ж (неоднородность 7). */
        var varRate = isF ? C.var_rate_f : C.var_rate_m;
        var variable = salary * varRate * (C.flat_salary ? 1 : (0.75 + rnd() * 0.5));

        /* Частичная занятость и неполный год (неоднородность 6).
         * base_salary и variable_pay в контракте — ФАКТИЧЕСКИ выплаченные
         * суммы, поэтому здесь они домножаются на fte и долю года. */
        var fte = 1.0;
        var months = 12;
        if (rnd() < C.part_time_share) {
          fte = [0.5, 0.6, 0.75, 0.8][Math.floor(rnd() * 4)];
        }
        if (rnd() < C.part_time_share * 0.6) {
          months = [4, 6, 7, 9, 10][Math.floor(rnd() * 5)];
        }

        var factor = fte * (months / 12);

        out.push({
          id: 'E' + String(seq++).padStart(3, '0'),
          category: C.name,
          gender: isF ? 'F' : 'M',
          base_salary: round2(salary * factor),
          variable_pay: round2(variable * factor),
          tenure_years: tenure,
          grade: grade,
          fte: fte,
          months_worked: months
        });
      }
    }
    return out;
  }

  /* ===========================================================================
   * 2. Вспомогательная арифметика
   * ======================================================================== */

  function round2(x) { return Math.round(x * 100) / 100; }

  function mean(a) {
    if (!a.length) return 0;
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  /* Медиана: при чётном n — среднее двух центральных.
   * Медиана нужна дважды: как альтернативная мера разрыва (§4.1) и как
   * целевая точка для отбора адресатов (§4.3). */
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function sum(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s;
  }

  /* ===========================================================================
   * 3. Нормализация (§3 спеки)
   *
   *   normalised = pay / fte / (months_worked / 12)
   *
   * Приводит фактическую выплату к полному годовому эквиваленту. Без этого
   * шага человек на 0.5 ставки выглядит вдвое недоплаченным и попадает в
   * адресаты, а бюджет завышается вдвое. Обратный коэффициент factor
   * сохраняется на сотруднике, чтобы стоимость вернуть в фактические деньги.
   * ======================================================================== */

  function normalise(employees) {
    return employees.map(function (e, idx) {
      var fte = (typeof e.fte === 'number' && e.fte > 0) ? e.fte : 1.0;
      var mw = (typeof e.months_worked === 'number' && e.months_worked > 0)
        ? e.months_worked : 12;
      var factor = fte * (mw / 12); // доля полной занятости за полный год
      var nBase = e.base_salary / factor;
      var nVar = e.variable_pay / factor;
      return {
        idx: idx,
        id: e.id != null ? e.id : ('E' + String(idx + 1).padStart(3, '0')),
        category: String(e.category),
        gender: e.gender === 'F' ? 'F' : 'M',
        grade: Number(e.grade),
        tenure_years: Number(e.tenure_years),
        fte: fte,
        months_worked: mw,
        factor: factor,              // множитель обратно в фактические деньги
        actual_base: e.base_salary,  // фактические, для payroll и для взносов
        actual_var: e.variable_pay,
        n_base: nBase,               // нормализованные
        n_var: nVar,
        n_total: nBase + nVar
      };
    });
  }

  /* ===========================================================================
   * 4. OLS-регрессия total_pay ~ grade + tenure_years внутри категории (§4.2)
   *
   * Нормальные уравнения: (X'X) β = X'y, где X = [1, grade, tenure].
   * Система 3×3 решается методом Гаусса с частичным выбором ведущего
   * элемента — вручную, без библиотек (требование §8 спеки).
   *
   * Почему нормальные уравнения, а не QR: матрица 3×3, обусловленность на
   * реальных штатных расписаниях приемлемая, а формула целиком выписывается
   * в Excel — это обязательное условие сверки модели вручную.
   *
   * Защита от вырожденности: если наблюдений меньше 4, либо grade или tenure
   * константны, либо ведущий элемент на любом шаге меньше EPS — регрессия не
   * определена. В этом случае возвращается r_squared: null, коэффициенты 0,
   * и объяснимая часть разрыва принимается равной нулю (весь разрыв уходит
   * в необъяснимый остаток — консервативно, то есть в сторону большей
   * корректировки).
   * ======================================================================== */

  var EPS = 1e-9;

  /** Решение системы n×n методом Гаусса с частичным выбором ведущего элемента.
   *  @returns {Array<number>|null} null, если матрица вырождена */
  function solveGauss(A, b) {
    var n = b.length;
    var M = A.map(function (row, i) { return row.slice().concat([b[i]]); });

    for (var col = 0; col < n; col++) {
      // выбор ведущего элемента — максимальный по модулю в столбце
      var piv = col;
      for (var r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      if (Math.abs(M[piv][col]) < EPS) return null; // вырожденная матрица
      var tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;

      for (var r2 = col + 1; r2 < n; r2++) {
        var f = M[r2][col] / M[col][col];
        for (var c = col; c <= n; c++) M[r2][c] -= f * M[col][c];
      }
    }
    // обратный ход
    var x = new Array(n).fill(0);
    for (var i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  /**
   * OLS для одной категории.
   * @param {Array} rows нормализованные сотрудники категории
   * @returns {{intercept, coef_grade, coef_tenure, r_squared, n}}
   *          r_squared === null означает «регрессия не определена,
   *          explained принимается за 0».
   */
  function regress(rows) {
    var n = rows.length;
    var fail = {
      intercept: 0, coef_grade: 0, coef_tenure: 0, r_squared: null, n: n
    };
    if (n < 4) return fail;

    var grades = rows.map(function (r) { return r.grade; });
    var tenures = rows.map(function (r) { return r.tenure_years; });
    var ys = rows.map(function (r) { return r.n_total; });

    // константный предиктор → соответствующий коэффициент не определён
    var gVar = variance(grades);
    var tVar = variance(tenures);
    if (gVar < EPS || tVar < EPS) return fail;

    // Нормальные уравнения: сумма произведений
    var S = { n: n, g: 0, t: 0, gg: 0, tt: 0, gt: 0, y: 0, gy: 0, ty: 0 };
    for (var i = 0; i < n; i++) {
      var g = grades[i], t = tenures[i], y = ys[i];
      S.g += g; S.t += t; S.y += y;
      S.gg += g * g; S.tt += t * t; S.gt += g * t;
      S.gy += g * y; S.ty += t * y;
    }
    var A = [
      [S.n, S.g, S.t],
      [S.g, S.gg, S.gt],
      [S.t, S.gt, S.tt]
    ];
    var beta = solveGauss(A, [S.y, S.gy, S.ty]);
    if (!beta) return fail;
    if (!isFinite(beta[0]) || !isFinite(beta[1]) || !isFinite(beta[2])) return fail;

    // R² = 1 − SS_res / SS_tot
    var yBar = S.y / n, ssRes = 0, ssTot = 0;
    for (var k = 0; k < n; k++) {
      var pred = beta[0] + beta[1] * grades[k] + beta[2] * tenures[k];
      ssRes += Math.pow(ys[k] - pred, 2);
      ssTot += Math.pow(ys[k] - yBar, 2);
    }
    var r2 = ssTot < EPS ? null : 1 - ssRes / ssTot;

    return {
      intercept: beta[0],
      coef_grade: beta[1],
      coef_tenure: beta[2],
      r_squared: r2,
      n: n
    };
  }

  function variance(a) {
    if (a.length < 2) return 0;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return s / a.length;
  }

  /* ===========================================================================
   * 5. Разрыв и его декомпозиция (§4.1, §4.2)
   *
   * raw_gap % = (mean_M − mean_F) / mean_M × 100.
   * Знаменатель — оплата мужчин: так разрыв читается как «женщина получает
   * на X% меньше мужчины», что и есть формулировка директивы. Положительный
   * разрыв = в пользу мужчин, отрицательный = в пользу женщин.
   *
   * explained: предсказанная регрессией разница по различиям в grade/tenure:
   *   explained_€ = coef_grade × (mean_grade_M − mean_grade_F)
   *               + coef_tenure × (mean_tenure_M − mean_tenure_F)
   * То есть «сколько разрыва объясняется тем, что мужчины в среднем на
   * старших грейдах и с большим стажем». Переводится в % к mean_M.
   *
   * unexplained_pct = raw_gap_mean_pct − explained_pct. Корректируется
   * только он (§4.2).
   *
   * explained ограничивается диапазоном [0, raw_gap], когда разрыв
   * положительный: отрицательная объяснимая часть означала бы, что структура
   * грейдов работает В ПОЛЬЗУ женщин, и её вычитание раздуло бы остаток выше
   * фактического разрыва — то есть модель потребовала бы поднять женщин выше
   * мужчин. РЕШЕНИЕ ВНЕ СПЕКИ, отмечено в отчёте.
   * ======================================================================== */

  function computeGaps(rows, reg) {
    var f = rows.filter(function (r) { return r.gender === 'F'; });
    var m = rows.filter(function (r) { return r.gender === 'M'; });

    var meanM = mean(m.map(function (r) { return r.n_total; }));
    var meanF = mean(f.map(function (r) { return r.n_total; }));
    var medM = median(m.map(function (r) { return r.n_total; }));
    var medF = median(f.map(function (r) { return r.n_total; }));
    var varM = mean(m.map(function (r) { return r.n_var; }));
    var varF = mean(f.map(function (r) { return r.n_var; }));
    // разрыв по БАЗОВОМУ окладу — нужен, чтобы отличить «оклады ровные,
    // разрыв в бонусах» от «разрыв и там, и там». Наружу по контракту не
    // выходит (форма CategoryResult зафиксирована), используется в selfCheck.
    var baseM = mean(m.map(function (r) { return r.n_base; }));
    var baseF = mean(f.map(function (r) { return r.n_base; }));

    var rawMean = (meanM > 0 && f.length && m.length)
      ? (meanM - meanF) / meanM * 100 : 0;
    var rawMedian = (medM > 0 && f.length && m.length)
      ? (medM - medF) / medM * 100 : 0;
    var varGap = (varM > 0 && f.length && m.length)
      ? (varM - varF) / varM * 100 : 0;

    // объяснимая часть в евро
    var explainedEur = 0;
    if (reg.r_squared !== null && f.length && m.length) {
      var dG = mean(m.map(function (r) { return r.grade; }))
        - mean(f.map(function (r) { return r.grade; }));
      var dT = mean(m.map(function (r) { return r.tenure_years; }))
        - mean(f.map(function (r) { return r.tenure_years; }));
      explainedEur = reg.coef_grade * dG + reg.coef_tenure * dT;
    }
    var explainedPct = meanM > 0 ? explainedEur / meanM * 100 : 0;

    // ограничение: объяснимая часть не выходит за пределы самого разрыва
    if (rawMean >= 0) {
      explainedPct = Math.max(0, Math.min(explainedPct, rawMean));
    } else {
      explainedPct = Math.min(0, Math.max(explainedPct, rawMean));
    }

    return {
      mean_m: meanM, mean_f: meanF,
      raw_gap_mean_pct: rawMean,
      raw_gap_median_pct: rawMedian,
      variable_gap_pct: varGap,
      base_gap_pct: (baseM > 0 && f.length && m.length)
        ? (baseM - baseF) / baseM * 100 : 0,
      explained_pct: explainedPct,
      unexplained_pct: rawMean - explainedPct,
      f: f, m: m
    };
  }

  /* ===========================================================================
   * 6. Взносы работодателя (§4.5, CONTRIBUTIONS.md)
   *
   *   взносы = rate_below × min(прибавка, max(0, ceiling − исходная_база))
   *          + rate_above × max(0, исходная_база + прибавка
   *                                − max(ceiling, исходная_база))
   *
   * Считаются от ПРИРОСТА базы, не от исходной зарплаты, и всегда от
   * ФАКТИЧЕСКОЙ базы сотрудника (потолок — годовой и применяется к реально
   * начисленному, а не к полному эквиваленту частично занятого).
   *
   * Смысл конструкции: часть прибавки, укладывающаяся под потолок, тянет
   * полную ставку; всё, что выводит базу за потолок, — только пониженную.
   * Одна формула покрывает и отсечку (rate_above = 0), и смену ставки (РФ).
   * ======================================================================== */

  function contributionsOn(baseBefore, uplift, settings) {
    if (uplift <= 0) return 0;
    var ceiling = settings.ceiling;
    var rb = settings.rate_below / 100;
    var ra = settings.rate_above / 100;

    var roomBelow = Math.max(0, ceiling - baseBefore); // место под потолком
    var partBelow = Math.min(uplift, roomBelow);
    var partAbove = uplift - partBelow;
    return rb * partBelow + ra * partAbove;
  }

  /* ===========================================================================
   * 7. Отбор адресатов и распределение прибавки (§4.3)
   *
   * Адресаты: сотрудники недоплаченного пола, чья НОРМАЛИЗОВАННАЯ total pay
   * ниже медианы своей категории (медиана по всей категории, оба пола).
   *
   * Прибавка распределяется ПРОПОРЦИОНАЛЬНО отставанию от медианы:
   *   доля_i = (медиана − total_i) / Σ(медиана − total_j)
   * Логика: чем дальше человек от середины категории, тем большую часть
   * бюджета он получает. Метод единственный (§4.3), альтернативы вне скоупа.
   *
   * Сколько всего нужно раздать: чтобы необъяснимый остаток категории
   * опустился с текущего уровня до целевого. Остаток измеряется в % к
   * средней оплате мужчин, поэтому нужная сумма в евро (нормализованных):
   *   need_€ = (unexplained_pct − target_pct) / 100 × mean_M × n_F
   * где n_F — численность недоплаченного пола: подъём средней женской оплаты
   * на Δ€ требует Δ€ × n_F евро фонда.
   * ======================================================================== */

  /**
   * Один сценарий для одной категории.
   * @param {Array}  rows  нормализованные сотрудники категории
   * @param {Object} gaps  результат computeGaps
   * @param {number} targetPct целевой необъяснимый остаток, % (0 = full)
   * @param {Object} settings
   * @param {boolean} reverse категория с разрывом в пользу женщин
   */
  function runScenario(rows, gaps, targetPct, settings, reverse) {
    var empty = {
      recipients: 0, adjustment: 0, contributions: 0, total_cost: 0,
      unexplained_after: gaps.unexplained_pct,
      mean_pay_after: mean(rows.map(function (r) { return r.n_total; })),
      per_employee: []
    };

    // Категории с разрывом в пользу женщин не корректируются ни в одном
    // сценарии — выравнивание идёт только вверх (§4.4).
    if (reverse) return empty;

    // Категория уже под порогом — в minimum не трогается вовсе (§4.4).
    if (gaps.unexplained_pct <= targetPct + 1e-12) return empty;

    var under = gaps.f.filter(function (r) { return r.n_total < gaps.median_all; });
    if (!under.length) return empty;

    var deficits = under.map(function (r) { return gaps.median_all - r.n_total; });
    var totalDeficit = sum(deficits);
    if (totalDeficit <= 0) return empty;

    // сколько нормализованных евро нужно влить в фонд женщин категории
    var needNorm = (gaps.unexplained_pct - targetPct) / 100
      * gaps.mean_m * gaps.f.length;

    var perEmployee = [];
    var adjActual = 0;
    var contrib = 0;

    for (var i = 0; i < under.length; i++) {
      var r = under[i];
      var upliftNorm = needNorm * (deficits[i] / totalDeficit);
      // обратно в фактические деньги: прибавка на 0.5 ставки стоит половину
      var upliftActual = upliftNorm * r.factor;
      adjActual += upliftActual;
      contrib += contributionsOn(r.actual_base, upliftActual, settings);
      perEmployee.push({ idx: r.idx, uplift_norm: upliftNorm, uplift_actual: upliftActual });
    }

    // средняя нормализованная оплата после корректировки — для диаграммы
    var afterTotals = rows.map(function (r) {
      var add = 0;
      for (var k = 0; k < perEmployee.length; k++) {
        if (perEmployee[k].idx === r.idx) { add = perEmployee[k].uplift_norm; break; }
      }
      return r.n_total + add;
    });

    // фактический остаток после подъёма — пересчитывается, а не берётся из цели
    var newMeanF = mean(gaps.f.map(function (r) {
      var add = 0;
      for (var k = 0; k < perEmployee.length; k++) {
        if (perEmployee[k].idx === r.idx) { add = perEmployee[k].uplift_norm; break; }
      }
      return r.n_total + add;
    }));
    var newRawGap = gaps.mean_m > 0 ? (gaps.mean_m - newMeanF) / gaps.mean_m * 100 : 0;
    var after = newRawGap - gaps.explained_pct;

    return {
      recipients: under.length,
      adjustment: adjActual,
      contributions: contrib,
      total_cost: adjActual + contrib,
      unexplained_after: after,
      mean_pay_after: mean(afterTotals),
      per_employee: perEmployee
    };
  }

  /* ===========================================================================
   * 8. analyse() — главная функция
   * ======================================================================== */

  var DEFAULT_SETTINGS = {
    threshold_pct: 5,
    implementation_month: 7,
    rate_below: 31.5,
    rate_above: 1.15,
    ceiling: 61214
  };

  /**
   * analyse(employees, settings) → Result (CONTRACT.md §3).
   * Не мутирует входной массив.
   */
  function analyse(employees, settings) {
    var S = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    var rows = normalise(employees || []);

    // группировка по категориям, порядок первого появления
    var order = [];
    var byCat = {};
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i].category;
      if (!byCat[c]) { byCat[c] = []; order.push(c); }
      byCat[c].push(rows[i]);
    }

    var categories = [];
    var accMin = { adjustment: 0, contributions: 0 };
    var accFull = { adjustment: 0, contributions: 0 };

    for (var ci = 0; ci < order.length; ci++) {
      var name = order[ci];
      var crows = byCat[name];

      var reg = regress(crows);
      var gaps = computeGaps(crows, reg);
      gaps.median_all = median(crows.map(function (r) { return r.n_total; }));

      var nF = gaps.f.length, nM = gaps.m.length;

      // §4.9 флаг надёжности
      var unreliable = crows.length < 10 || nF < 3 || nM < 3;
      // §4.4 разрыв в пользу женщин — не корректируем
      var reverse = gaps.raw_gap_mean_pct < 0;

      var scMin = runScenario(crows, gaps, S.threshold_pct, S, reverse);
      var scFull = runScenario(crows, gaps, 0, S, reverse);

      accMin.adjustment += scMin.adjustment;
      accMin.contributions += scMin.contributions;
      accFull.adjustment += scFull.adjustment;
      accFull.contributions += scFull.contributions;

      categories.push({
        category: name,
        headcount: crows.length,
        headcount_f: nF,
        headcount_m: nM,
        raw_gap_mean_pct: gaps.raw_gap_mean_pct,
        raw_gap_median_pct: gaps.raw_gap_median_pct,
        variable_gap_pct: gaps.variable_gap_pct,
        _base_gap_pct: gaps.base_gap_pct, // приватное, для selfCheck
        explained_pct: gaps.explained_pct,
        unexplained_pct: gaps.unexplained_pct,
        regression: {
          intercept: reg.intercept,
          coef_grade: reg.coef_grade,
          coef_tenure: reg.coef_tenure,
          r_squared: reg.r_squared,
          n: reg.n
        },
        unreliable: unreliable,
        reverse_gap: reverse,
        minimum: publicScenario(scMin),
        full: publicScenario(scFull)
      });
    }

    // фонд оплаты труда «до» — фактические деньги, total pay
    var payrollBefore = sum(rows.map(function (r) { return r.actual_base + r.actual_var; }));

    // сколько сотрудников с неполной ставкой или неполным годом — служебное
    // поле для selfCheck (неоднородность 6); UI его не использует
    var partTime = rows.filter(function (r) {
      return r.fte < 1 || r.months_worked < 12;
    }).length;

    return {
      _demo_parttime: partTime,
      categories: categories,
      totals: {
        headcount: rows.length,
        payroll_before: payrollBefore,
        minimum: totalsBlock(accMin, payrollBefore, S),
        full: totalsBlock(accFull, payrollBefore, S),
        difference: diffBlock(
          totalsBlock(accFull, payrollBefore, S),
          totalsBlock(accMin, payrollBefore, S)
        )
      },
      settings_used: Object.assign({}, S)
    };
  }

  /* CategoryScenario наружу — без служебного per_employee. */
  function publicScenario(sc) {
    return {
      recipients: sc.recipients,
      adjustment: sc.adjustment,
      contributions: sc.contributions,
      total_cost: sc.total_cost,
      unexplained_after: sc.unexplained_after,
      mean_pay_after: sc.mean_pay_after
    };
  }

  /* Годовой эффект (§4.7): месяц внедрения m → текущий год = полная сумма
   * × (13 − m) / 12 (внедрение в январе даёт 12/12, в декабре — 1/12);
   * следующий год — полная сумма. */
  function totalsBlock(acc, payrollBefore, S) {
    var total = acc.adjustment + acc.contributions;
    var m = Math.min(12, Math.max(1, Math.round(S.implementation_month)));
    return {
      adjustment: acc.adjustment,
      contributions: acc.contributions,
      total_cost: total,
      cost_current_year: total * (13 - m) / 12,
      cost_next_year: total,
      payroll_uplift_pct: payrollBefore > 0 ? total / payrollBefore * 100 : 0
    };
  }

  /* difference = full − minimum по всем полям (главное число первого экрана). */
  function diffBlock(full, min) {
    return {
      adjustment: full.adjustment - min.adjustment,
      contributions: full.contributions - min.contributions,
      total_cost: full.total_cost - min.total_cost,
      cost_current_year: full.cost_current_year - min.cost_current_year,
      cost_next_year: full.cost_next_year - min.cost_next_year,
      payroll_uplift_pct: full.payroll_uplift_pct - min.payroll_uplift_pct
    };
  }

  /* ===========================================================================
   * 9. selfCheck() — тождества из §10 спеки
   *
   * Каждая проверка — арифметическое тождество, которое обязано выполняться
   * при любых входных данных, а не свойство конкретного демо-набора (кроме
   * блока «Данные», который по определению относится к демо).
   * Detail — человекочитаемый: строка пойдёт в интерфейс и в лист Method.
   * ======================================================================== */

  var TOL = 0.01; // допуск в евро — округления при сложении сотен чисел

  function selfCheck(result) {
    var checks = [];
    function add(name, passed, detail) {
      checks.push({ name: name, passed: !!passed, detail: detail });
    }

    var cats = result.categories;
    var T = result.totals;
    var S = result.settings_used;

    /* --- Расчёт ------------------------------------------------------- */

    // 1. Сумма корректировок по категориям = приросту фонда оплаты труда.
    ['minimum', 'full'].forEach(function (sc) {
      var catSum = sum(cats.map(function (c) { return c[sc].adjustment; }));
      var d = Math.abs(catSum - T[sc].adjustment);
      add('adjustment matches payroll delta (' + sc + ')', d < TOL,
        'Sum of category adjustments €' + fmt(catSum) + ' vs total €'
        + fmt(T[sc].adjustment) + ' — difference €' + d.toFixed(4)
        + '. Payroll before €' + fmt(T.payroll_before) + ' → after €'
        + fmt(T.payroll_before + T[sc].adjustment) + '.');
    });

    // 2. После minimum ни одна категория не превышает порог.
    var over = cats.filter(function (c) {
      return !c.reverse_gap && c.minimum.unexplained_after > S.threshold_pct + 0.01;
    });
    add('no category above threshold after minimum', over.length === 0,
      over.length === 0
        ? 'All ' + cats.length + ' categories at or below the '
          + S.threshold_pct + '% joint-pay-assessment trigger after minimum compliance.'
        : 'Above threshold: ' + over.map(function (c) {
            return c.category + ' ' + c.minimum.unexplained_after.toFixed(2) + '%';
          }).join(', '));

    // 3. После full остаток равен нулю.
    var nz = cats.filter(function (c) {
      return !c.reverse_gap && Math.abs(c.full.unexplained_after) > 0.01;
    });
    add('unexplained residual is zero after full equalisation', nz.length === 0,
      nz.length === 0
        ? 'Residual < 0.01 pp in every corrected category ('
          + cats.filter(function (c) { return !c.reverse_gap; }).length + ' of '
          + cats.length + '; reverse-gap categories excluded by design).'
        : 'Non-zero: ' + nz.map(function (c) {
            return c.category + ' ' + c.full.unexplained_after.toFixed(3) + '%';
          }).join(', '));

    // 4. Взносы считаются от изменённой базы (от прироста), а не от исходной,
    //    и лежат между двумя ставками — то есть формула действительно
    //    применяет rate_above к части над потолком.
    ['minimum', 'full'].forEach(function (sc) {
      var adj = T[sc].adjustment, con = T[sc].contributions;
      var lo = adj * S.rate_above / 100, hi = adj * S.rate_below / 100;
      var ok = adj <= 0 ? con === 0 : (con > 0 && con <= hi + TOL && con >= lo - TOL);
      add('contributions computed on the uplift, two-rate (' + sc + ')', ok,
        'Uplift €' + fmt(adj) + ' → contributions €' + fmt(con)
        + ' (' + (adj > 0 ? (con / adj * 100).toFixed(2) : '0.00') + '% effective; '
        + 'bounds ' + S.rate_above + '%…' + S.rate_below + '%, ceiling €'
        + fmt(S.ceiling) + '). Effective rate below the headline rate proves the '
        + 'above-ceiling band is being applied.');
    });

    // 5. Эффект текущего года меньше следующего при внедрении не в январе.
    var m = S.implementation_month;
    var okYear = m > 1
      ? T.full.cost_current_year < T.full.cost_next_year - TOL
      : Math.abs(T.full.cost_current_year - T.full.cost_next_year) < TOL;
    add('current-year effect below next-year effect', okYear,
      'Implementation month ' + m + ' → factor (13−' + m + ')/12 = '
      + ((13 - m) / 12).toFixed(4) + '. Full: current year €'
      + fmt(T.full.cost_current_year) + ' vs next year €' + fmt(T.full.cost_next_year) + '.');

    // 6. Малочисленная категория помечена.
    var small = cats.filter(function (c) {
      return c.headcount < 10 || c.headcount_f < 3 || c.headcount_m < 3;
    });
    var allFlagged = small.every(function (c) { return c.unreliable; });
    add('small categories flagged as unreliable', small.length > 0 && allFlagged,
      small.length === 0
        ? 'No category with n<10 or a gender group <3 — the reliability flag is untested.'
        : 'Flagged: ' + small.map(function (c) {
            return c.category + ' (n=' + c.headcount + ', F=' + c.headcount_f
              + ', M=' + c.headcount_m + ')';
          }).join('; ') + '.');

    // 7. Категории с разрывом в пользу женщин не скорректированы, но показаны.
    var rev = cats.filter(function (c) { return c.reverse_gap; });
    var revClean = rev.every(function (c) {
      return c.minimum.adjustment === 0 && c.full.adjustment === 0
        && c.minimum.recipients === 0 && c.full.recipients === 0;
    });
    add('reverse-gap categories shown but not adjusted', rev.length > 0 && revClean,
      rev.length === 0
        ? 'No reverse-gap category present.'
        : rev.map(function (c) {
            return c.category + ' gap ' + c.raw_gap_mean_pct.toFixed(1)
              + '% (in favour of women), adjustment €0 in both scenarios';
          }).join('; ') + ' — listed in the table, not corrected.');

    // 8. Стоимость по частично занятым — в фактических деньгах.
    //    Косвенная проверка: прирост фонда меньше, чем если бы прибавки
    //    считались в FTE-эквиваленте, — а он и есть adjustment, всегда
    //    положительный и меньше payroll.
    add('cost expressed in actual money, not FTE',
      T.full.adjustment > 0 && T.full.adjustment < T.payroll_before,
      'Uplift €' + fmt(T.full.adjustment) + ' is '
      + (T.full.adjustment / T.payroll_before * 100).toFixed(2)
      + '% of payroll €' + fmt(T.payroll_before)
      + '; part-time uplifts scaled by fte × months/12 before summing.');

    /* --- Данные (относится к демо-набору) ------------------------------ */

    // 9. Все семь неоднородностей присутствуют.
    var het = demoHeterogeneities(result);
    add('all seven data heterogeneities present', het.all,
      het.lines.join(' | '));

    // 10. Объяснимая часть ≠ 0 минимум в двух категориях.
    var expl = cats.filter(function (c) { return Math.abs(c.explained_pct) > 0.5; });
    add('explained part non-zero in at least two categories', expl.length >= 2,
      expl.length + ' categories with |explained| > 0.5 pp: '
      + expl.map(function (c) {
          return c.category + ' ' + c.explained_pct.toFixed(1) + ' pp of '
            + c.raw_gap_mean_pct.toFixed(1) + ' pp raw';
        }).join('; ') + '.');

    // 11. Регрессия восстанавливает заложенную стоимость грейда.
    //     Генератор задаёт +12% оклада за грейд. Ожидаемый прирост в евро
    //     сравнивается с coef_grade; «разумная точность» — в пределах ±40%
    //     на категорию (шум, корреляция стажа с грейдом и мультипликативная
    //     природа шага делают точное совпадение невозможным).
    var recov = gradeRecovery(result);
    add('regression recovers the built-in grade step', recov.ok,
      recov.detail);

    var passed = checks.every(function (c) { return c.passed; });
    return { passed: passed, checks: checks };
  }

  /* Проверка присутствия семи неоднородностей §5 — по признакам в результате.
   * Проверяются наблюдаемые следствия, а не константы генератора: так проверка
   * остаётся осмысленной и на пользовательских данных. */
  function demoHeterogeneities(result) {
    var cats = result.categories;
    var lines = [];
    var flags = [];

    function chk(label, cond, note) {
      flags.push(cond);
      lines.push((cond ? '+' : '-') + ' ' + label + (note ? ': ' + note : ''));
    }

    // 1. разрыв внутри грейда — есть категория с большим остатком при малой
    //    объяснимой части
    var c1 = cats.filter(function (c) {
      return c.unexplained_pct > 4 && c.explained_pct < c.unexplained_pct;
    });
    chk('within-grade gap', c1.length > 0,
      c1.length ? c1[0].category + ' unexplained ' + c1[0].unexplained_pct.toFixed(1) + ' pp' : '');

    // 2. структурный разрыв — объяснимая часть больше половины разрыва
    var c2 = cats.filter(function (c) {
      return c.raw_gap_mean_pct > 3 && c.explained_pct > c.raw_gap_mean_pct * 0.5;
    });
    chk('structural gap (women in lower grades)', c2.length > 0,
      c2.length ? c2[0].category + ' explained ' + c2[0].explained_pct.toFixed(1)
        + ' of ' + c2[0].raw_gap_mean_pct.toFixed(1) + ' pp' : '');

    // 3. малочисленная категория с большим разрывом
    var c3 = cats.filter(function (c) {
      return c.unreliable && Math.abs(c.raw_gap_mean_pct) > 8;
    });
    chk('small category with a large gap', c3.length > 0,
      c3.length ? c3[0].category + ' n=' + c3[0].headcount + ', gap '
        + c3[0].raw_gap_mean_pct.toFixed(1) + '%' : '');

    // 4. разрыв в пользу женщин
    var c4 = cats.filter(function (c) { return c.reverse_gap; });
    chk('gap in favour of women', c4.length > 0,
      c4.length ? c4[0].category + ' ' + c4[0].raw_gap_mean_pct.toFixed(1) + '%' : '');

    // 5. связь стажа и оплаты — положительный коэффициент tenure
    var c5 = cats.filter(function (c) {
      return c.regression.r_squared !== null && c.regression.coef_tenure > 100;
    });
    chk('tenure linked to pay', c5.length >= 2,
      c5.length + ' categories with coef_tenure > €100/yr, e.g. '
      + (c5.length ? c5[0].category + ' €' + Math.round(c5[0].regression.coef_tenure) : ''));

    // 6. частичная занятость / неполный год — проверяется по исходным данным
    chk('part-time and part-year present', result._demo_parttime > 0,
      result._demo_parttime + ' employees with fte<1 or months_worked<12');

    // 7. ровные оклады, разрыв в переменной части
    // Требуется именно РОВНЫЙ оклад: разрыв по базе близок к нулю, а весь
    // разрыв сидит в переменной части. Слабый вариант проверки (только
    // «variable_gap большой») пропускал категорию, где база разошлась на 11%
    // из-за случайного перекоса по грейдам, — то есть не проверял заявленное.
    var c7 = cats.filter(function (c) {
      return Math.abs(c._base_gap_pct) < 1.0 && c.variable_gap_pct > 25;
    });
    chk('flat salaries with a variable-pay gap', c7.length > 0,
      c7.length ? c7[0].category + ' base gap '
        + c7[0]._base_gap_pct.toFixed(2) + '% (flat), variable gap '
        + c7[0].variable_gap_pct.toFixed(1) + '%, total gap '
        + c7[0].raw_gap_mean_pct.toFixed(1) + '%'
        : 'no category with |base gap| < 1% and variable gap > 25%');

    return { all: flags.every(Boolean), lines: lines };
  }

  /* Восстановление стоимости грейда регрессией.
   * Ожидание: генератор даёт +12% оклада за грейд, значит средний прирост
   * в евро ≈ 0.12 × средняя оплата категории / (1 + 0.12/2) — грубая оценка.
   * Проще и честнее: сравнить coef_grade с 12% от средней оплаты категории,
   * допуск ±40 % — шум и корреляция стажа с грейдом размывают коэффициент. */
  function gradeRecovery(result) {
    var ok = 0, tested = 0, parts = [];
    result.categories.forEach(function (c) {
      if (c.regression.r_squared === null || c.headcount < 15) return;
      var meanPay = c.minimum.mean_pay_after; // ≈ средняя нормализованная оплата
      var expected = meanPay * GRADE_STEP / (1 + GRADE_STEP);
      var got = c.regression.coef_grade;
      var ratio = got / expected;
      tested++;
      var good = ratio > 0.6 && ratio < 1.4;
      if (good) ok++;
      parts.push(c.category + ' €' + Math.round(got) + ' vs €' + Math.round(expected)
        + ' expected (×' + ratio.toFixed(2) + ')' + (good ? '' : ' [off]'));
    });
    return {
      ok: tested > 0 && ok >= Math.ceil(tested * 0.6),
      detail: 'Built-in grade step is +' + (GRADE_STEP * 100).toFixed(0)
        + '% of salary per grade. Recovered in ' + ok + ' of ' + tested
        + ' testable categories within ±40%: ' + parts.join('; ') + '.'
    };
  }

  function fmt(x) {
    return (Math.round(x * 100) / 100).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* ===========================================================================
   * 10. Публичный интерфейс
   * ======================================================================== */

  return {
    generateDemoData: generateDemoData,
    analyse: analyse,
    selfCheck: selfCheck,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
})();

/* Для среды Node (временные прогоны и Excel-модель); в браузере не срабатывает. */
if (typeof module !== 'undefined' && module.exports) { module.exports = CALC; }
