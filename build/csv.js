/* ============================================================================
   Часть C — импорт CSV и валидация.
   Публичный интерфейс: CSV.parse(text) → ParseResult (§4 CONTRACT.md).

   Чистый ES2020, глобальный объект, без модулей и внешних зависимостей.
   Основная функция чистая: строка на входе, объект на выходе.
   DOM трогает только необязательный хелпер CSV.readFile (FileReader).

   Сообщения пользователю — по-английски: интерфейс англоязычный.
   ========================================================================== */

var CSV = (function () {
  'use strict';

  // --- Константы -----------------------------------------------------------

  // Обязательные колонки по §3 спеки и §4 контракта.
  var REQUIRED = [
    'category',
    'gender',
    'base_salary',
    'variable_pay',
    'tenure_years',
    'grade'
  ];

  // Необязательные колонки с молчаливыми дефолтами.
  var DEFAULTS = { fte: 1.0, months_worked: 12 };

  // Доля испорченных строк, выше которой файл считается негодным целиком.
  var MAX_BAD_ROW_SHARE = 0.20;

  // Словарь синонимов заголовков из типовых HR-выгрузок.
  // Ключ — уже нормализованный заголовок (нижний регистр, подчёркивания),
  // значение — каноническое имя колонки.
  var SYNONYMS = {
    // base_salary
    salary: 'base_salary',
    annual_salary: 'base_salary',
    base_pay: 'base_salary',
    basic_salary: 'base_salary',
    base: 'base_salary',
    fixed_pay: 'base_salary',
    gross_salary: 'base_salary',
    // variable_pay
    bonus: 'variable_pay',
    variable: 'variable_pay',
    variable_compensation: 'variable_pay',
    variable_salary: 'variable_pay',
    bonus_pay: 'variable_pay',
    incentive: 'variable_pay',
    // gender
    sex: 'gender',
    // category
    job_category: 'category',
    job_family: 'category',
    category_of_work: 'category',
    work_category: 'category',
    job_group: 'category',
    // tenure_years
    tenure: 'tenure_years',
    years_of_service: 'tenure_years',
    seniority: 'tenure_years',
    service_years: 'tenure_years',
    // grade
    level: 'grade',
    job_level: 'grade',
    band: 'grade',
    pay_grade: 'grade',
    // fte
    full_time_equivalent: 'fte',
    fte_ratio: 'fte',
    workload: 'fte',
    part_time_factor: 'fte',
    // months_worked
    months: 'months_worked',
    months_in_year: 'months_worked',
    worked_months: 'months_worked',
    // id
    employee_id: 'id',
    emp_id: 'id',
    employee_number: 'id',
    staff_id: 'id',
    personnel_number: 'id'
  };

  // Распознаваемые значения пола → 'F' | 'M'.
  var GENDER_MAP = {
    f: 'F', female: 'F', woman: 'F', women: 'F', w: 'F',
    'ж': 'F', 'жен': 'F', 'женщина': 'F', 'женский': 'F',
    m: 'M', male: 'M', man: 'M', men: 'M',
    'м': 'M', 'муж': 'M', 'мужчина': 'M', 'мужской': 'M'
  };

  // --- Низкоуровневый парсер CSV -------------------------------------------

  /**
   * Убирает BOM (Excel ставит его почти всегда) и нормализует переводы строк.
   * CRLF и одиночный CR приводятся к LF, чтобы дальше работать с одним видом.
   */
  function stripBomAndNormalise(text) {
    var s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  /**
   * Автоопределение разделителя: запятая или точка с запятой.
   * Считаем вхождения ВНЕ кавычек в первых непустых строках; побеждает частый.
   * При ничьей выбираем точку с запятой — европейские выгрузки встречаются чаще
   * в сценариях, где ничья вообще возможна (десятичная запятая внутри чисел).
   */
  function detectDelimiter(text) {
    var counts = { ',': 0, ';': 0 };
    var inQuotes = false;
    var lines = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') {
        // Удвоенная кавычка внутри поля — не смена режима.
        if (inQuotes && text[i + 1] === '"') { i++; continue; }
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes) {
        if (ch === ',' || ch === ';') counts[ch]++;
        else if (ch === '\n') {
          lines++;
          if (lines >= 5) break; // пяти строк достаточно
        }
      }
    }
    if (counts[';'] > counts[',']) return ';';
    if (counts[','] > counts[';']) return ',';
    return ';';
  }

  /**
   * Разбор текста в матрицу строк. Поддерживает кавычки, удвоенные кавычки
   * внутри поля ("" → "), переводы строк внутри кавычек.
   * Пустые строки пропускаются (в том числе хвостовые).
   */
  function splitRows(text, delim) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var fieldWasQuoted = false;

    function pushField() {
      row.push(fieldWasQuoted ? field : field.trim());
      field = '';
      fieldWasQuoted = false;
    }
    function pushRow() {
      pushField();
      // Строка считается пустой, если все её поля пусты.
      var empty = row.every(function (c) { return c === ''; });
      if (!empty) rows.push(row);
      row = [];
    }

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') { inQuotes = true; fieldWasQuoted = true; }
        else if (ch === delim) pushField();
        else if (ch === '\n') pushRow();
        else field += ch;
      }
    }
    // Хвост последней строки без завершающего перевода.
    if (field !== '' || row.length > 0) pushRow();
    return rows;
  }

  // --- Нормализация заголовков ---------------------------------------------

  /**
   * «Base Salary», «base-salary», «BASE_SALARY» → base_salary.
   * Нижний регистр, обрезка пробелов, пробелы/дефисы/точки → подчёркивание,
   * схлопывание повторов и обрезка подчёркиваний по краям.
   */
  function normaliseHeader(h) {
    return String(h == null ? '' : h)
      .replace(/^﻿/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s\-.]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /** Каноническое имя колонки: нормализация + словарь синонимов. */
  function canonicalHeader(h) {
    var n = normaliseHeader(h);
    return Object.prototype.hasOwnProperty.call(SYNONYMS, n) ? SYNONYMS[n] : n;
  }

  // --- Разбор значений ------------------------------------------------------

  /**
   * Числа в европейском и обычном формате.
   * Принимает «52.000,50», «52 000,50», «52000.50», «€ 52,000.50», «1 234».
   * Отбрасывает валютные символы и пробелы (в т.ч. неразрывные) как разделители тысяч.
   * Формат определяется по позиции ПОСЛЕДНЕГО разделителя:
   *   - если после него 1–2 цифры и до конца строки — он десятичный;
   *   - иначе оба вида разделителей — тысячные.
   * Возвращает число или null, если распознать не удалось.
   */
  function parseNumber(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (s === '') return null;

    // Убираем валюту, пробелы (обычные, неразрывные, узкие) и апострофы-разделители.
    s = s.replace(/[€$£¥\s   ']/g, '');
    if (s === '') return null;

    // Знак.
    var negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); } // (1 234) — минус в бухгалтерском виде
    if (s[0] === '+') s = s.slice(1);
    else if (s[0] === '-') { negative = true; s = s.slice(1); }

    if (!/^[0-9.,]*$/.test(s) || !/[0-9]/.test(s)) return null;

    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    var lastSep = Math.max(lastComma, lastDot);

    var intPart, fracPart = '';
    if (lastSep === -1) {
      intPart = s;
    } else {
      var sepChar = s[lastSep];
      var tail = s.slice(lastSep + 1);
      // Десятичный разделитель: 1–2 цифры в хвосте и он единственный в своём роде.
      var sameCharCount = s.split(sepChar).length - 1;
      var isDecimal = /^[0-9]{1,2}$/.test(tail) && sameCharCount === 1;
      // «1.234» неоднозначно: точка с тремя цифрами — тысячи, поэтому 1–2 цифры.
      if (isDecimal) {
        intPart = s.slice(0, lastSep);
        fracPart = tail;
      } else {
        intPart = s;
      }
    }
    intPart = intPart.replace(/[.,]/g, '');
    if (intPart === '') intPart = '0';
    if (!/^[0-9]+$/.test(intPart) || (fracPart !== '' && !/^[0-9]+$/.test(fracPart))) return null;

    var value = Number(intPart + (fracPart ? '.' + fracPart : ''));
    if (!isFinite(value)) return null;
    return negative ? -value : value;
  }

  /** Пол: F/M/female/male/woman/man/ж/м в любом регистре → 'F' | 'M' | null. */
  function parseGender(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().toLowerCase().replace(/[.\s]+$/, '');
    if (s === '') return null;
    return Object.prototype.hasOwnProperty.call(GENDER_MAP, s) ? GENDER_MAP[s] : null;
  }

  /** Порядковый id вида E001, E002, … когда колонки id в файле нет. */
  function makeId(n) {
    var s = String(n);
    while (s.length < 3) s = '0' + s;
    return 'E' + s;
  }

  /** Склонение по-английски: 1 row / 2 rows. */
  function rowWord(n) { return n === 1 ? 'row' : 'rows'; }

  // --- Публичный parse ------------------------------------------------------

  /**
   * CSV.parse(text) → { ok, employees, errors, warnings }
   * Одна кривая строка не роняет файл: она попадает в warnings и пропускается.
   * Если испорчено больше 20% строк — это ошибка файла целиком.
   */
  function parse(text) {
    var errors = [];
    var warnings = [];
    var fail = function () {
      return { ok: false, employees: [], errors: errors, warnings: warnings };
    };

    var normalised = stripBomAndNormalise(text);
    if (normalised.trim() === '') {
      errors.push('The file is empty. Export a CSV with a header row and one row per employee.');
      return fail();
    }

    var delim = detectDelimiter(normalised);
    var rows = splitRows(normalised, delim);

    if (rows.length === 0) {
      errors.push('The file has no readable rows. Export a CSV with a header row and one row per employee.');
      return fail();
    }

    // --- Заголовки ---
    var rawHeaders = rows[0];
    var headers = rawHeaders.map(canonicalHeader);
    var present = {};
    headers.forEach(function (h, i) {
      if (h !== '' && !Object.prototype.hasOwnProperty.call(present, h)) present[h] = i;
    });

    var foundList = headers.filter(function (h) { return h !== ''; }).join(', ');
    var missing = REQUIRED.filter(function (c) {
      return !Object.prototype.hasOwnProperty.call(present, c);
    });

    if (missing.length > 0) {
      // Сообщение должно называть недостающее и показывать найденное,
      // чтобы пользователь сразу понял, что чинить в выгрузке.
      var what = missing.length === 1
        ? 'Required column "' + missing[0] + '" is missing.'
        : 'Required columns are missing: ' + missing.map(function (m) { return '"' + m + '"'; }).join(', ') + '.';
      errors.push(
        what +
        ' The file has these columns: ' + (foundList || '(none)') + '.' +
        ' Rename the matching column in your export, or add it.' +
        ' Required columns are: ' + REQUIRED.join(', ') + '.' +
        ' Optional: fte (defaults to 1.0), months_worked (defaults to 12), id (generated if absent).'
      );
      return fail();
    }

    if (rows.length < 2) {
      errors.push('The file has a header row but no data rows. Add one row per employee below the header.');
      return fail();
    }

    // --- Строки ---
    var employees = [];
    var badRows = [];              // сообщения о пропущенных строках
    var dataRowCount = rows.length - 1;
    var defaultsUsed = { fte: 0, months_worked: 0 };
    var idSeen = {};
    var autoIdCounter = 0;
    var hasIdColumn = Object.prototype.hasOwnProperty.call(present, 'id');
    var genderSeen = { F: 0, M: 0 };
    var duplicateIdCount = 0;

    // Значение ячейки по каноническому имени колонки.
    function cell(row, name) {
      var idx = present[name];
      if (idx === undefined) return '';
      var v = row[idx];
      return v === undefined || v === null ? '' : String(v).trim();
    }

    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var lineNo = r + 1; // номер строки в файле, как его видит пользователь
      var problem = null;

      // Пол.
      var genderRaw = cell(row, 'gender');
      var gender = parseGender(genderRaw);
      if (gender === null) {
        problem = genderRaw === ''
          ? 'gender is empty'
          : 'gender value "' + genderRaw + '" is not recognised (use F/M, female/male)';
      }

      // Категория.
      var category = cell(row, 'category');
      if (problem === null && category === '') problem = 'category is empty';

      // Числовые поля.
      var base_salary = null, variable_pay = null, tenure_years = null, grade = null;
      var fte = DEFAULTS.fte, months_worked = DEFAULTS.months_worked;

      if (problem === null) {
        var baseRaw = cell(row, 'base_salary');
        base_salary = parseNumber(baseRaw);
        if (base_salary === null) {
          problem = baseRaw === ''
            ? 'base_salary is empty'
            : 'base_salary value "' + baseRaw + '" is not a number';
        } else if (base_salary < 0) {
          problem = 'base_salary is negative (' + baseRaw + ')';
        }
      }

      if (problem === null) {
        // Пустая ячейка variable_pay = 0. Это нормально и не предупреждение.
        var varRaw = cell(row, 'variable_pay');
        if (varRaw === '') variable_pay = 0;
        else {
          variable_pay = parseNumber(varRaw);
          if (variable_pay === null) problem = 'variable_pay value "' + varRaw + '" is not a number';
          else if (variable_pay < 0) problem = 'variable_pay is negative (' + varRaw + ')';
        }
      }

      if (problem === null) {
        var tenRaw = cell(row, 'tenure_years');
        tenure_years = parseNumber(tenRaw);
        if (tenure_years === null) {
          problem = tenRaw === ''
            ? 'tenure_years is empty'
            : 'tenure_years value "' + tenRaw + '" is not a number';
        } else if (tenure_years < 0) {
          problem = 'tenure_years is negative (' + tenRaw + ')';
        }
      }

      if (problem === null) {
        var gradeRaw = cell(row, 'grade');
        grade = parseNumber(gradeRaw);
        if (grade === null) {
          problem = gradeRaw === ''
            ? 'grade is empty'
            : 'grade value "' + gradeRaw + '" is not a number';
        } else {
          grade = Math.round(grade); // грейд — порядковый целый уровень
        }
      }

      // fte: пусто → дефолт 1.0 (молча, но со сводкой в warnings).
      if (problem === null) {
        var fteRaw = cell(row, 'fte');
        if (fteRaw === '') { fte = DEFAULTS.fte; defaultsUsed.fte++; }
        else {
          fte = parseNumber(fteRaw);
          if (fte === null) problem = 'fte value "' + fteRaw + '" is not a number';
          else if (!(fte > 0 && fte <= 1)) problem = 'fte is outside the allowed range 0 < fte <= 1 (' + fteRaw + ')';
        }
      }

      // months_worked: пусто → дефолт 12.
      if (problem === null) {
        var mwRaw = cell(row, 'months_worked');
        if (mwRaw === '') { months_worked = DEFAULTS.months_worked; defaultsUsed.months_worked++; }
        else {
          months_worked = parseNumber(mwRaw);
          if (months_worked === null) problem = 'months_worked value "' + mwRaw + '" is not a number';
          else if (!(months_worked > 0 && months_worked <= 12)) {
            problem = 'months_worked is outside the allowed range 0 < months_worked <= 12 (' + mwRaw + ')';
          }
        }
      }

      if (problem !== null) {
        badRows.push('Row ' + lineNo + ' skipped: ' + problem + '.');
        continue;
      }

      // id: из колонки либо сгенерированный.
      var id = hasIdColumn ? cell(row, 'id') : '';
      if (id === '') {
        do { autoIdCounter++; id = makeId(autoIdCounter); } while (idSeen[id]);
      }
      if (idSeen[id]) {
        // Дубликат id не повод терять строку: делаем уникальным и считаем в сводке.
        duplicateIdCount++;
        var suffix = 2;
        while (idSeen[id + '-' + suffix]) suffix++;
        id = id + '-' + suffix;
      }
      idSeen[id] = true;

      genderSeen[gender]++;

      employees.push({
        id: id,
        category: category,
        gender: gender,
        base_salary: base_salary,
        variable_pay: variable_pay,
        tenure_years: tenure_years,
        grade: grade,
        fte: fte,
        months_worked: months_worked
      });
    }

    // --- Сводки в warnings ---
    if (defaultsUsed.fte > 0) {
      warnings.push(defaultsUsed.fte + ' ' + rowWord(defaultsUsed.fte) + ' had no fte, assumed 1.0.');
    }
    if (defaultsUsed.months_worked > 0) {
      warnings.push(defaultsUsed.months_worked + ' ' + rowWord(defaultsUsed.months_worked) +
        ' had no months_worked, assumed 12.');
    }
    if (duplicateIdCount > 0) {
      warnings.push(duplicateIdCount + ' ' + rowWord(duplicateIdCount) +
        ' had a duplicate id; a suffix was added to keep every id unique.');
    }

    // --- Устойчивость: доля испорченных строк ---
    var badShare = dataRowCount > 0 ? badRows.length / dataRowCount : 0;
    if (badRows.length > 0 && badShare > MAX_BAD_ROW_SHARE) {
      var pct = Math.round(badShare * 100);
      errors.push(
        pct + '% of the data rows could not be read (' + badRows.length + ' of ' + dataRowCount +
        '), which is too many to trust the result. This usually means the wrong column separator, ' +
        'a shifted header row, or a different export than expected. The first problems are listed below.'
      );
      errors = errors.concat(badRows.slice(0, 10));
      if (badRows.length > 10) errors.push('… and ' + (badRows.length - 10) + ' more ' + rowWord(badRows.length - 10) + '.');
      return fail();
    }

    // Проблемные строки, которых немного, — предупреждения с номерами строк.
    if (badRows.length > 0) {
      warnings.push(badRows.length + ' ' + rowWord(badRows.length) +
        (badRows.length === 1 ? ' was' : ' were') + ' skipped because of unreadable values.');
      warnings = warnings.concat(badRows.slice(0, 20));
      if (badRows.length > 20) warnings.push('… and ' + (badRows.length - 20) + ' more skipped ' + rowWord(badRows.length - 20) + '.');
    }

    if (employees.length === 0) {
      errors.push('No usable employee rows were found in the file. Check that the data rows sit directly under the header row.');
      return fail();
    }

    // Расчёт разрыва невозможен без обоих полов.
    if (genderSeen.F === 0 || genderSeen.M === 0) {
      var have = genderSeen.F > 0 ? 'F' : 'M';
      errors.push(
        'Only one gender was recognised in the file (' + have + '). A pay gap needs both women and men, ' +
        'so nothing can be compared. Check the gender column: accepted values are F/M, female/male, woman/man.'
      );
      return fail();
    }

    return { ok: true, employees: employees, errors: [], warnings: warnings };
  }

  // --- Необязательный хелпер для браузера ----------------------------------

  /**
   * Читает File из <input type="file"> и отдаёт ParseResult в колбэк.
   * Единственное место, где часть C касается браузерного API. Сеть не трогается:
   * FileReader читает локальный файл.
   */
  function readFile(file, callback) {
    if (typeof FileReader === 'undefined') {
      callback({ ok: false, employees: [], errors: ['File reading is not supported in this browser.'], warnings: [] });
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { callback(parse(reader.result)); };
    reader.onerror = function () {
      callback({ ok: false, employees: [], errors: ['The file could not be read. Try saving it again as CSV and re-uploading.'], warnings: [] });
    };
    reader.readAsText(file, 'utf-8');
  }

  return {
    parse: parse,
    readFile: readFile,
    REQUIRED_COLUMNS: REQUIRED.slice(),
    DEFAULTS: { fte: DEFAULTS.fte, months_worked: DEFAULTS.months_worked },
    // Открыто для тестов и листа Method; UI сюда не обязан лезть.
    _internals: {
      normaliseHeader: normaliseHeader,
      canonicalHeader: canonicalHeader,
      parseNumber: parseNumber,
      parseGender: parseGender,
      detectDelimiter: detectDelimiter,
      SYNONYMS: SYNONYMS
    }
  };
})();

// Экспорт для Node — только чтобы прогонять тесты вне браузера.
// В собранной странице этой ветки не существует: typeof module === 'undefined'.
if (typeof module !== 'undefined' && module.exports) module.exports = CSV;
