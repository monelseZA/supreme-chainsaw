// Application State
const state = {
  onboarding: {
    region: "South Africa",
    industry: "SaaS/Tech",
    vatRate: 15,
    vatExtract: false
  },
  csvData: {
    fileName: "",
    rawContent: "",
    delimiter: ",",
    allParsedRows: [],
    validRows: [],
    headers: [],
    dateColIdx: -1,
    descColIdx: -1,
    amountColIdx: -1
  },
  transactions: [], // Parsed and mapped transactions
  timeAggregation: "monthly", // "monthly" or "quarterly"
  dashboardTab: "table", // "table" or "charts"
  chartInstances: {
    performanceChart: null,
    expenseBreakdownChart: null
  }
};

// ==========================================
// CSV PARSING & NORMALIZATION ENGINE
// ==========================================

function parseCSVLine(text, delimiter = ',') {
  let val = "";
  let insideQuote = false;
  const row = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      insideQuote = !insideQuote;
    } else if (char === delimiter && !insideQuote) {
      row.push(val.trim());
      val = "";
    } else {
      val += char;
    }
  }
  row.push(val.trim());
  return row;
}

function processCSVContent(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) {
    alert("The uploaded file is empty.");
    return false;
  }

  // Detect delimiter (comma, semicolon, tab)
  let commas = 0, semicolons = 0, tabs = 0;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    commas += (lines[i].match(/,/g) || []).length;
    semicolons += (lines[i].match(/;/g) || []).length;
    tabs += (lines[i].match(/\t/g) || []).length;
  }
  let delimiter = ',';
  if (semicolons > commas && semicolons > tabs) delimiter = ';';
  else if (tabs > commas) delimiter = '\t';

  state.csvData.delimiter = delimiter;
  state.csvData.rawContent = csvText;

  const allParsedRows = lines.map(line => parseCSVLine(line, delimiter));
  state.csvData.allParsedRows = allParsedRows;

  // Row Filtering: ignore rows without date patterns
  // Date patterns: YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, MM/DD/YYYY, YYYYMMDD
  const dateRegex = /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})|(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})|(\d{8})\b/;

  const validRows = [];
  const metadataRows = [];

  allParsedRows.forEach(row => {
    // A row is valid if at least one column matches a date pattern
    const hasDate = row.some(cell => dateRegex.test(cell));
    if (hasDate) {
      validRows.push(row);
    } else {
      metadataRows.push(row);
    }
  });

  if (validRows.length === 0) {
    alert("Could not detect transaction rows with valid dates in the CSV file.");
    return false;
  }

  state.csvData.validRows = validRows;

  // Identify Header Row from metadata rows (search from bottom up)
  const keywords = ["date", "desc", "detail", "amount", "val", "trans", "payee", "ref", "cost"];
  let bestHeader = null;
  let maxScore = -1;

  for (let i = metadataRows.length - 1; i >= 0; i--) {
    const row = metadataRows[i];
    let score = 0;
    row.forEach(cell => {
      const lower = cell.toLowerCase();
      keywords.forEach(kw => {
        if (lower.includes(kw)) score++;
      });
    });
    if (score > maxScore && score > 0) {
      maxScore = score;
      bestHeader = row;
    }
  }

  // Generate generic headers if not found
  if (!bestHeader) {
    bestHeader = Array(validRows[0].length).fill(0).map((_, idx) => `Column ${idx + 1}`);
  }

  // Handle case where header has fewer columns than actual rows
  while (bestHeader.length < validRows[0].length) {
    bestHeader.push(`Column ${bestHeader.length + 1}`);
  }

  state.csvData.headers = bestHeader;

  // Run automated heuristics to predict column indices
  const heuristics = runColumnHeuristics(validRows);
  state.csvData.dateColIdx = heuristics.dateColIdx;
  state.csvData.descColIdx = heuristics.descColIdx;
  state.csvData.amountColIdx = heuristics.amountColIdx;

  return true;
}

function runColumnHeuristics(validRows) {
  const numCols = validRows[0].length;
  const dateScores = Array(numCols).fill(0);
  const amountScores = Array(numCols).fill(0);
  const descScores = Array(numCols).fill(0);

  const dateRegex = /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})|(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})|(\d{8})\b/;
  const amountRegex = /^-?\$?£?€?\d+([.,]\d{1,2})?$/;

  // Sample up to 50 rows for heuristic scoring
  const sampleRows = validRows.slice(0, 50);

  sampleRows.forEach(row => {
    row.forEach((cell, colIdx) => {
      if (!cell) return;
      const cleanCell = cell.replace(/[\s$,£€]/g, '');

      // Date check
      if (dateRegex.test(cell)) {
        dateScores[colIdx]++;
      }

      // Amount check (number, and not matching date)
      if (amountRegex.test(cleanCell) && !dateRegex.test(cell)) {
        const val = parseFloat(cleanCell.replace(/,/g, ''));
        if (!isNaN(val)) {
          amountScores[colIdx]++;
        }
      }

      // Description check
      const hasLetters = /[a-zA-Z]/.test(cell);
      if (hasLetters && !dateRegex.test(cell) && !amountRegex.test(cleanCell)) {
        descScores[colIdx] += cell.length;
      }
    });
  });

  // Pick Date Column
  let dateColIdx = dateScores.indexOf(Math.max(...dateScores));

  // Pick Amount Column (must not be Date Column)
  let maxAmountScore = -1;
  let amountColIdx = -1;
  for (let j = 0; j < numCols; j++) {
    if (j === dateColIdx) continue;
    if (amountScores[j] > maxAmountScore) {
      maxAmountScore = amountScores[j];
      amountColIdx = j;
    }
  }
  if (amountColIdx === -1) amountColIdx = (dateColIdx + 1) % numCols;

  // Pick Description Column (must not be Date or Amount)
  let maxDescScore = -1;
  let descColIdx = -1;
  for (let j = 0; j < numCols; j++) {
    if (j === dateColIdx || j === amountColIdx) continue;
    if (descScores[j] > maxDescScore) {
      maxDescScore = descScores[j];
      descColIdx = j;
    }
  }
  if (descColIdx === -1) {
    for (let j = 0; j < numCols; j++) {
      if (j !== dateColIdx && j !== amountColIdx) {
        descColIdx = j;
        break;
      }
    }
  }
  if (descColIdx === -1) descColIdx = (amountColIdx + 1) % numCols;

  return { dateColIdx, descColIdx, amountColIdx };
}

// Helper to parse dates into ISO YYYY-MM-DD
function parseISOString(dateStr, region) {
  if (!dateStr) return "";
  dateStr = dateStr.trim();

  // Try YYYYMMDD
  if (/^\d{8}$/.test(dateStr)) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }

  const parts = dateStr.split(/[-/.]/);
  if (parts.length === 3) {
    let p1 = parts[0].padStart(2, '0');
    let p2 = parts[1].padStart(2, '0');
    let p3 = parts[2];

    if (p1.length === 4) {
      // YYYY-MM-DD
      return `${p1}-${p2}-${p3.padStart(2, '0')}`;
    } else if (p3.length === 4) {
      // DD-MM-YYYY or MM-DD-YYYY
      if (region === "United States") {
        // MM-DD-YYYY
        return `${p3}-${p1}-${p2}`;
      } else {
        // DD-MM-YYYY
        return `${p3}-${p2}-${p1}`;
      }
    }
  }

  // Date object fallback
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return dateStr;
}

// Helper to parse amounts into decimals
function parseDecimalAmount(amountStr) {
  if (!amountStr) return 0;
  // Strip currency symbols and space
  let clean = amountStr.replace(/[\s$£€()]/g, '');

  // Handle accounting brackets (e.g. (1,200.50))
  let isNegative = amountStr.includes('(') && amountStr.includes(')');
  if (clean.startsWith('-')) {
    isNegative = true;
    clean = clean.substring(1);
  }

  // Replace commas
  // Some locales use comma as decimal, but standard CSV floats usually use dot
  // We clean up dot/comma
  const dots = (clean.match(/\./g) || []).length;
  const commas = (clean.match(/,/g) || []).length;

  if (commas === 1 && dots === 0) {
    // comma is likely decimal
    clean = clean.replace(',', '.');
  } else {
    // standard thousands commas
    clean = clean.replace(/,/g, '');
  }

  let val = parseFloat(clean);
  if (isNaN(val)) return 0;

  return isNegative ? -val : val;
}

// ==========================================
// HEURISTIC CATEGORY MAPPING ENGINE
// ==========================================

function getAutomaticCategory(desc, amount, industry) {
  if (amount > 0) {
    const isUS = state.onboarding.region === "United States";
    return isUS ? "Revenue" : "Turnover";
  }

  const descLower = desc.toLowerCase();

  // Internal transfers check (all industries)
  if (
    descLower.includes("transfer to") ||
    descLower.includes("house save") ||
    descLower.includes("large save") ||
    descLower.includes("month save")
  ) {
    return "Internal Transfer";
  }

  // Industry specific logic
  if (industry === "SaaS/Tech") {
    if (descLower.includes("aws") || descLower.includes("google cloud") || descLower.includes("vercel")) {
      return "COGS (Hosting)";
    }
    if (descLower.includes("slack") || descLower.includes("zoom") || descLower.includes("adobe")) {
      return "OPEX (Software)";
    }
  } 
  
  if (industry === "Retail/E-commerce") {
    if (
      descLower.includes("cargo") ||
      descLower.includes("shipping") ||
      descLower.includes("packaging") ||
      descLower.includes("supplier")
    ) {
      return "COGS (Manufacturing/Freight)";
    }
  } 
  
  if (industry === "Hospitality/Brick-and-Mortar") {
    if (
      descLower.includes("wholefood") ||
      descLower.includes("ingredients") ||
      descLower.includes("produce") ||
      descLower.includes("food cc")
    ) {
      return "COGS (Food & Beverage Stock)";
    }
    if (
      descLower.includes("electric") ||
      descLower.includes("gas") ||
      descLower.includes("power") ||
      descLower.includes("city of johannesbu")
    ) {
      return "OPEX (Utilities)";
    }
  } 
  
  if (industry === "Consultancy/Agency") {
    if (
      descLower.includes("freelance") ||
      descLower.includes("contractor") ||
      descLower.includes("upwork")
    ) {
      return "COGS (Contractor Fees)";
    }
  }

  return "Uncategorized OPEX";
}

// Master lists of categories
const masterCategoryList = [
  "Revenue",
  "Turnover",
  "COGS (Hosting)",
  "COGS (Manufacturing/Freight)",
  "COGS (Food & Beverage Stock)",
  "COGS (Contractor Fees)",
  "OPEX (Software)",
  "OPEX (Utilities)",
  "OPEX (Staff Wages)",
  "OPEX (Marketing)",
  "OPEX (Rent/Facilities)",
  "OPEX (General & Admin)",
  "Uncategorized OPEX"
];

// Returns recommended categories as first items, then the rest
function getCategoriesForDropdown(industry, region) {
  const isUS = region === "United States";
  const revLabel = isUS ? "Revenue" : "Turnover";
  const directCostsLabel = isUS ? "COGS" : "Direct Costs";

  let recommended = [];
  if (industry === "SaaS/Tech") {
    recommended = [revLabel, "COGS (Hosting)", "OPEX (Software)", "OPEX (Marketing)", "OPEX (Rent/Facilities)", "OPEX (General & Admin)", "Uncategorized OPEX"];
  } else if (industry === "Retail/E-commerce") {
    recommended = [revLabel, "COGS (Manufacturing/Freight)", "OPEX (Marketing)", "OPEX (Software)", "OPEX (Rent/Facilities)", "OPEX (General & Admin)", "Uncategorized OPEX"];
  } else if (industry === "Hospitality/Brick-and-Mortar") {
    recommended = [revLabel, "COGS (Food & Beverage Stock)", "OPEX (Utilities)", "OPEX (Staff Wages)", "OPEX (Rent/Facilities)", "OPEX (Marketing)", "OPEX (General & Admin)", "Uncategorized OPEX"];
  } else {
    recommended = [revLabel, "COGS (Contractor Fees)", "OPEX (Software)", "OPEX (Marketing)", "OPEX (Rent/Facilities)", "OPEX (General & Admin)", "Uncategorized OPEX"];
  }

  // Exclude duplicate label naming
  const otherOptions = masterCategoryList.filter(cat => {
    // If US, filter out Turnover. If UK/AU/ZA, filter out Revenue.
    if (isUS && cat === "Turnover") return false;
    if (!isUS && cat === "Revenue") return false;
    return !recommended.includes(cat);
  });

  return { recommended, otherOptions };
}

// Ingest transaction rows based on mapping configuration
function ingestTransactions() {
  const data = state.csvData;
  const region = state.onboarding.region;
  const industry = state.onboarding.industry;
  const vatRate = state.onboarding.vatRate;
  const extractTax = state.onboarding.vatExtract;

  const result = [];

  data.validRows.forEach((row, idx) => {
    const rawDate = row[data.dateColIdx] || "";
    const rawDesc = row[data.descColIdx] || "";
    const rawAmount = row[data.amountColIdx] || "";

    const dateStr = parseISOString(rawDate, region);
    const amountVal = parseDecimalAmount(rawAmount);

    const category = getAutomaticCategory(rawDesc, amountVal, industry);
    const isExcluded = category === "Internal Transfer";

    // Tax processing
    // If extracting tax, check if amount is negative and row is not excluded
    let taxAmount = 0;
    let netAmount = amountVal;

    if (extractTax && amountVal < 0 && !isExcluded) {
      const rateFactor = vatRate / 100;
      netAmount = amountVal / (1 + rateFactor);
      taxAmount = amountVal - netAmount; // (will be negative)
    }

    result.push({
      id: idx,
      date: dateStr,
      rawDescription: rawDesc,
      amount: amountVal,
      category: category,
      isExcluded: isExcluded,
      taxAmount: taxAmount,
      netAmount: netAmount
    });
  });

  state.transactions = result;
}

// ==========================================
// FINANCIAL CALCULATION ENGINE
// ==========================================

function compileFinancialReport() {
  const isUS = state.onboarding.region === "United States";
  const revLabel = isUS ? "Revenue" : "Turnover";
  const cogsLabel = isUS ? "COGS" : "Direct Costs";
  
  // Filter active transactions
  const activeTx = state.transactions.filter(tx => !tx.isExcluded);

  // Determine unique dates grouping keys
  const groups = new Set();
  const activeYears = new Set();
  activeTx.forEach(tx => {
    if (!tx.date) return;
    const parts = tx.date.split('-');
    if (parts.length < 1) return;
    const year = parts[0];
    if (year && year.length === 4) {
      activeYears.add(year);
    }
  });

  // If no years found, default to current year
  if (activeYears.size === 0) {
    activeYears.add(new Date().getFullYear().toString());
  }

  // Generate full calendar months/quarters for active years to ensure columns change
  const sortedYears = Array.from(activeYears).sort();
  sortedYears.forEach(year => {
    if (state.timeAggregation === "monthly") {
      for (let m = 1; m <= 12; m++) {
        groups.add(`${year}-${String(m).padStart(2, '0')}`);
      }
    } else {
      for (let q = 1; q <= 4; q++) {
        groups.add(`${year}-Q${q}`);
      }
    }
  });

  // Sort groups chronologically
  const sortedKeys = Array.from(groups).sort();

  // Categories lists
  const revenueCategories = [revLabel];
  const cogsCategories = ["COGS (Hosting)", "COGS (Manufacturing/Freight)", "COGS (Food & Beverage Stock)", "COGS (Contractor Fees)"];
  const opexCategories = [
    "OPEX (Software)", "OPEX (Utilities)", "OPEX (Staff Wages)", 
    "OPEX (Marketing)", "OPEX (Rent/Facilities)", "OPEX (General & Admin)", 
    "Uncategorized OPEX"
  ];

  // Initialize data structures
  // { key: { Revenue: 0, COGS: { "COGS (Hosting)": 0, ... }, OPEX: { ... }, Tax: 0 } }
  const dataMap = {};
  sortedKeys.forEach(k => {
    dataMap[k] = {
      revenueSum: 0,
      cogsSum: 0,
      cogsBreakdown: {},
      opexSum: 0,
      opexBreakdown: {},
      taxSum: 0
    };
    cogsCategories.forEach(c => dataMap[k].cogsBreakdown[c] = 0);
    opexCategories.forEach(o => dataMap[k].opexBreakdown[o] = 0);
  });

  // Populate dataMap
  activeTx.forEach(tx => {
    if (!tx.date) return;
    const parts = tx.date.split('-');
    if (parts.length < 2) return;
    const year = parts[0];
    const month = parts[1];
    
    let key = "";
    if (state.timeAggregation === "monthly") {
      key = `${year}-${month}`;
    } else {
      const q = Math.ceil(parseInt(month) / 3);
      key = `${year}-Q${q}`;
    }

    if (!dataMap[key]) return;

    const cat = tx.category;
    const net = tx.netAmount;
    const tax = tx.taxAmount;

    // Accumulate tax
    dataMap[key].taxSum += Math.abs(tax);

    if (revenueCategories.includes(cat) || cat === "Revenue" || cat === "Turnover") {
      dataMap[key].revenueSum += net; // net of tax (revenue typically won't have tax deducted anyway)
    } else if (cogsCategories.includes(cat)) {
      // COGS is positive in the P&L report
      dataMap[key].cogsSum += Math.abs(net);
      dataMap[key].cogsBreakdown[cat] += Math.abs(net);
    } else if (opexCategories.includes(cat)) {
      // OPEX is positive in the P&L report
      dataMap[key].opexSum += Math.abs(net);
      dataMap[key].opexBreakdown[cat] += Math.abs(net);
    } else {
      // Fallback to Uncategorized OPEX if it doesn't match standard
      dataMap[key].opexSum += Math.abs(net);
      dataMap[key].opexBreakdown["Uncategorized OPEX"] += Math.abs(net);
    }
  });

  return {
    keys: sortedKeys,
    data: dataMap,
    cogsCategories,
    opexCategories
  };
}

// Helper to format currency values
function formatCurrency(val, region) {
  let symbol = "$";
  if (region === "United Kingdom") symbol = "£";
  else if (region === "Australia") symbol = "A$";
  else if (region === "South Africa") symbol = "R";

  const formatted = Math.abs(val).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  return val < 0 ? `(${symbol}${formatted})` : `${symbol}${formatted}`;
}

// Helper to format short group keys to readable labels (e.g. 2026-01 -> Jan 2026)
function formatGroupKey(key) {
  if (key.includes('-Q')) {
    const parts = key.split('-Q');
    return `Q${parts[1]} ${parts[0]}`;
  }
  const parts = key.split('-');
  if (parts.length === 2) {
    const year = parts[0];
    const month = parseInt(parts[1]) - 1;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[month]} ${year}`;
  }
  return key;
}

// ==========================================
// DOM INTERACTORS & VIEW UPDATES
// ==========================================

function updateStepper(activeStep) {
  const steps = ["onboarding", "upload", "review", "report"];
  steps.forEach((step, idx) => {
    const el = document.getElementById(`step-indicator-${step}`);
    if (!el) return;

    el.className = "step-item";
    if (idx < activeStep) {
      el.classList.add("completed");
    } else if (idx === activeStep) {
      el.classList.add("current");
    } else {
      el.classList.add("upcoming");
    }

    // Set dividers
    const div = document.getElementById(`step-divider-${step}`);
    if (div) {
      div.className = "step-divider";
      if (idx < activeStep) div.classList.add("completed");
    }
  });
}

function showStep(stepId) {
  document.querySelectorAll(".wizard-step").forEach(el => el.classList.remove("active"));
  const activeStepEl = document.getElementById(stepId);
  if (activeStepEl) activeStepEl.classList.add("active");

  // Map step numeric IDs for stepper highlight
  let stepNum = 0;
  if (stepId === "step-upload") stepNum = 1;
  else if (stepId === "step-review" || stepId === "step-schema") stepNum = 2;
  else if (stepId === "step-report") stepNum = 3;

  updateStepper(stepNum);
}

// Step 1 -> Step 2
function saveOnboardingProfile() {
  state.onboarding.region = document.getElementById("profile-region").value;
  state.onboarding.industry = document.getElementById("profile-industry").value;
  
  const vatRateInput = document.getElementById("profile-vat-rate");
  state.onboarding.vatRate = parseFloat(vatRateInput.value) || 0;
  
  state.onboarding.vatExtract = document.getElementById("profile-vat-extract").checked;

  // Localize UI labels
  localizeTerminologies();

  showStep("step-upload");
}

// Localize labels based on onboarding region
function localizeTerminologies() {
  const isUS = state.onboarding.region === "United States";
  const revLabel = isUS ? "Revenue" : "Turnover";
  const cogsLabel = isUS ? "COGS" : "Stock/Direct Costs";
  const netLabel = isUS ? "Net Income" : "Net Profit";

  // Update dynamic elements
  document.querySelectorAll(".lbl-revenue").forEach(el => el.textContent = revLabel);
  document.querySelectorAll(".lbl-cogs").forEach(el => el.textContent = cogsLabel);
  document.querySelectorAll(".lbl-net-profit").forEach(el => el.textContent = netLabel);
}

// Step 2.5: Render Schema Mapping
function renderSchemaPreview() {
  const data = state.csvData;
  const selectDate = document.getElementById("schema-date-col");
  const selectDesc = document.getElementById("schema-desc-col");
  const selectAmount = document.getElementById("schema-amount-col");

  // Populate options
  const populateOptions = (selectEl, selectedIdx) => {
    selectEl.innerHTML = "";
    data.headers.forEach((header, idx) => {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.textContent = `${header} (Col ${idx + 1})`;
      if (idx === selectedIdx) opt.selected = true;
      selectEl.appendChild(opt);
    });
  };

  populateOptions(selectDate, data.dateColIdx);
  populateOptions(selectDesc, data.descColIdx);
  populateOptions(selectAmount, data.amountColIdx);

  updateSchemaTablePreview();
}

function updateSchemaTablePreview() {
  const data = state.csvData;
  const dateIdx = parseInt(document.getElementById("schema-date-col").value);
  const descIdx = parseInt(document.getElementById("schema-desc-col").value);
  const amountIdx = parseInt(document.getElementById("schema-amount-col").value);

  const previewBody = document.getElementById("schema-preview-body");
  const previewHeaders = document.getElementById("schema-preview-headers");

  // Set header highlights
  previewHeaders.innerHTML = "";
  data.headers.forEach((h, idx) => {
    const th = document.createElement("th");
    th.textContent = h;
    if (idx === dateIdx) {
      th.style.backgroundColor = "var(--primary-background-subtle)";
      th.style.color = "var(--primary-background-default)";
      th.textContent += " [DATE]";
    } else if (idx === descIdx) {
      th.style.backgroundColor = "var(--secondary-background-subtle)";
      th.style.color = "var(--secondary-background-default)";
      th.textContent += " [DESC]";
    } else if (idx === amountIdx) {
      th.style.backgroundColor = "var(--success-background-subtle)";
      th.style.color = "var(--success-background-default)";
      th.textContent += " [AMOUNT]";
    }
    previewHeaders.appendChild(th);
  });

  // Display first 3 rows
  previewBody.innerHTML = "";
  data.validRows.slice(0, 3).forEach(row => {
    const tr = document.createElement("tr");
    row.forEach((cell, idx) => {
      const td = document.createElement("td");
      td.textContent = cell;
      if (idx === dateIdx) td.style.backgroundColor = "rgba(33, 107, 228, 0.04)";
      else if (idx === descIdx) td.style.backgroundColor = "rgba(119, 37, 157, 0.04)";
      else if (idx === amountIdx) td.style.backgroundColor = "rgba(46, 163, 73, 0.04)";
      tr.appendChild(td);
    });
    previewBody.appendChild(tr);
  });
}

function confirmSchemaAlignment() {
  state.csvData.dateColIdx = parseInt(document.getElementById("schema-date-col").value);
  state.csvData.descColIdx = parseInt(document.getElementById("schema-desc-col").value);
  state.csvData.amountColIdx = parseInt(document.getElementById("schema-amount-col").value);

  // Formulate transactions based on selections
  ingestTransactions();

  // Render Step 3
  renderReviewTable();

  showStep("step-review");
}

// Step 3: Render Review & Map Table
function renderReviewTable() {
  const tbody = document.getElementById("review-table-body");
  tbody.innerHTML = "";

  const region = state.onboarding.region;
  const industry = state.onboarding.industry;
  const isUS = region === "United States";
  
  const dropDownData = getCategoriesForDropdown(industry, region);

  state.transactions.forEach((tx, idx) => {
    const tr = document.createElement("tr");
    tr.id = `tx-row-${tx.id}`;
    if (tx.isExcluded) tr.classList.add("excluded-row");

    // Checkbox (Exclude)
    const tdExclude = document.createElement("td");
    tdExclude.className = "text-center";
    const labelEx = document.createElement("label");
    labelEx.className = "checkbox-container";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = tx.isExcluded;
    chk.onchange = () => toggleTransactionExcluded(tx.id, chk.checked);
    const span = document.createElement("span");
    span.className = "checkbox-custom";
    labelEx.appendChild(chk);
    labelEx.appendChild(span);
    tdExclude.appendChild(labelEx);

    // Date
    const tdDate = document.createElement("td");
    tdDate.className = "mono-cell";
    tdDate.textContent = tx.date || "N/A";

    // Description
    const tdDesc = document.createElement("td");
    tdDesc.textContent = tx.rawDescription;
    
    // Add small status tag to description if it matched payee rules
    const lowerDesc = tx.rawDescription.toLowerCase();
    const isMatched = (
      lowerDesc.includes("aws") || lowerDesc.includes("google cloud") || lowerDesc.includes("vercel") ||
      lowerDesc.includes("slack") || lowerDesc.includes("zoom") || lowerDesc.includes("adobe") ||
      lowerDesc.includes("cargo") || lowerDesc.includes("shipping") || lowerDesc.includes("packaging") || lowerDesc.includes("supplier") ||
      lowerDesc.includes("wholefood") || lowerDesc.includes("ingredients") || lowerDesc.includes("produce") || lowerDesc.includes("food cc") ||
      lowerDesc.includes("electric") || lowerDesc.includes("gas") || lowerDesc.includes("power") || lowerDesc.includes("city of johannesbu") ||
      lowerDesc.includes("freelance") || lowerDesc.includes("contractor") || lowerDesc.includes("upwork") ||
      lowerDesc.includes("transfer to") || lowerDesc.includes("house save") || lowerDesc.includes("large save") || lowerDesc.includes("month save")
    );

    if (isMatched) {
      const matchBadge = document.createElement("span");
      matchBadge.className = "chip chip-info";
      matchBadge.style.marginLeft = "var(--space-2)";
      matchBadge.style.fontSize = "10px";
      matchBadge.style.padding = "1px var(--space-2)";
      matchBadge.innerHTML = `<span class="dot dot-info"></span> Auto-mapped`;
      tdDesc.appendChild(matchBadge);
    }

    // Original Amount
    const tdAmt = document.createElement("td");
    tdAmt.className = "text-right mono-cell";
    tdAmt.textContent = formatCurrency(tx.amount, region);
    if (tx.amount < 0) tdAmt.style.color = "var(--error-background-default)";
    else tdAmt.style.color = "var(--success-background-default)";

    // Tax Component
    const tdTax = document.createElement("td");
    tdTax.className = "text-right mono-cell text-muted";
    tdTax.textContent = tx.taxAmount !== 0 ? formatCurrency(tx.taxAmount, region) : "—";

    // Net Amount
    const tdNet = document.createElement("td");
    tdNet.className = "text-right mono-cell";
    tdNet.style.fontWeight = "var(--weight-semibold)";
    tdNet.textContent = formatCurrency(tx.netAmount, region);
    if (tx.netAmount < 0) tdNet.style.color = "var(--error-background-default)";
    else tdNet.style.color = "var(--success-background-default)";

    // Category Select
    const tdCat = document.createElement("td");
    const sel = document.createElement("select");
    sel.onchange = () => updateTransactionCategory(tx.id, sel.value);

    // Build options structure
    const recGroup = document.createElement("optgroup");
    recGroup.label = "Recommended for " + industry;
    dropDownData.recommended.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (tx.category === c) opt.selected = true;
      recGroup.appendChild(opt);
    });
    sel.appendChild(recGroup);

    const otherGroup = document.createElement("optgroup");
    otherGroup.label = "Other Categories";
    dropDownData.otherOptions.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (tx.category === c) opt.selected = true;
      otherGroup.appendChild(opt);
    });
    
    // Add Internal Transfer option
    const optTransfer = document.createElement("option");
    optTransfer.value = "Internal Transfer";
    optTransfer.textContent = "Internal Transfer (Exclude)";
    if (tx.category === "Internal Transfer") optTransfer.selected = true;
    otherGroup.appendChild(optTransfer);

    sel.appendChild(otherGroup);
    tdCat.appendChild(sel);

    tr.appendChild(tdExclude);
    tr.appendChild(tdDate);
    tr.appendChild(tdDesc);
    tr.appendChild(tdAmt);
    tr.appendChild(tdTax);
    tr.appendChild(tdNet);
    tr.appendChild(tdCat);

    tbody.appendChild(tr);
  });
}

function toggleTransactionExcluded(txId, isChecked) {
  const tx = state.transactions.find(t => t.id === txId);
  if (tx) {
    tx.isExcluded = isChecked;
    const row = document.getElementById(`tx-row-${txId}`);
    if (row) {
      if (isChecked) row.classList.add("excluded-row");
      else row.classList.remove("excluded-row");
    }
  }
}

function updateTransactionCategory(txId, newCategory) {
  const tx = state.transactions.find(t => t.id === txId);
  if (tx) {
    tx.category = newCategory;
    
    // If user maps to Internal Transfer, check the exclude box and dim
    const isTransfer = newCategory === "Internal Transfer";
    tx.isExcluded = isTransfer;
    
    const row = document.getElementById(`tx-row-${txId}`);
    if (row) {
      const chk = row.querySelector("input[type='checkbox']");
      if (chk) chk.checked = isTransfer;
      if (isTransfer) row.classList.add("excluded-row");
      else row.classList.remove("excluded-row");
    }
  }
}

// Step 4: Render Profit & Loss Dashboard
function generatePLStatement() {
  // Aggregate data
  const report = compileFinancialReport();
  
  // Render report details
  renderPLMatrixTable(report);

  // Render quick metric cards
  renderPLMetricCards(report);

  // Render ChartJS
  renderPLCharts(report);

  showStep("step-report");
}

function renderPLMetricCards(report) {
  const region = state.onboarding.region;
  let totalRevenue = 0;
  let totalCOGS = 0;
  let totalOPEX = 0;
  let totalTax = 0;

  report.keys.forEach(k => {
    const val = report.data[k];
    totalRevenue += val.revenueSum;
    totalCOGS += val.cogsSum;
    totalOPEX += val.opexSum;
    totalTax += val.taxSum;
  });

  const grossProfit = totalRevenue - totalCOGS;
  const ebitda = grossProfit - totalOPEX;
  const netIncome = ebitda - totalTax;

  const cardRev = document.getElementById("metric-rev");
  const cardGross = document.getElementById("metric-gross");
  const cardOpex = document.getElementById("metric-opex");
  const cardNet = document.getElementById("metric-net");

  cardRev.textContent = formatCurrency(totalRevenue, region);
  cardGross.textContent = formatCurrency(grossProfit, region);
  cardOpex.textContent = formatCurrency(totalOPEX, region);
  
  const netContainer = document.getElementById("metric-net-container");
  cardNet.textContent = formatCurrency(netIncome, region);

  const statusEl = document.getElementById("metric-net-status");
  statusEl.innerHTML = "";
  if (netIncome >= 0) {
    statusEl.className = "metric-card-status status-positive";
    statusEl.innerHTML = `<span class="dot dot-success"></span> Net Income Positive`;
  } else {
    statusEl.className = "metric-card-status status-negative";
    statusEl.innerHTML = `<span class="dot dot-error"></span> Net Loss`;
  }
}

function renderPLMatrixTable(report) {
  const isUS = state.onboarding.region === "United States";
  const region = state.onboarding.region;
  const revLabel = isUS ? "Revenue" : "Turnover";
  const cogsLabel = isUS ? "COGS" : "Direct Costs";
  const grossLabel = isUS ? "Gross Profit" : "Gross Margin";
  const netLabel = isUS ? "Net Income" : "Net Profit";

  const matrixHead = document.getElementById("matrix-head");
  const matrixBody = document.getElementById("matrix-body");

  matrixHead.innerHTML = "";
  matrixBody.innerHTML = "";

  // 1. Headers (Line Item | Group 1 | Group 2 | ... | Total)
  const trHead = document.createElement("tr");
  const thLabel = document.createElement("th");
  thLabel.textContent = "Financial Statement Line Item";
  trHead.appendChild(thLabel);

  report.keys.forEach(k => {
    const th = document.createElement("th");
    th.className = "text-right";
    th.textContent = formatGroupKey(k);
    trHead.appendChild(th);
  });

  const thTotal = document.createElement("th");
  thTotal.className = "text-right";
  thTotal.textContent = "Total";
  trHead.appendChild(thTotal);
  matrixHead.appendChild(trHead);

  // Rows generator helper
  const createPLRow = (label, indentClass, groupSumFn, isSubtotal = false, isGrandTotal = false) => {
    const tr = document.createElement("tr");
    tr.className = "pl-row";
    if (indentClass) tr.classList.add(indentClass);
    if (isSubtotal) tr.classList.add("subtotal");
    if (isGrandTotal) tr.classList.add("grand-total");

    const tdLbl = document.createElement("td");
    tdLbl.className = "pl-label";
    tdLbl.textContent = label;
    tr.appendChild(tdLbl);

    let rowTotal = 0;
    report.keys.forEach(k => {
      const cellVal = groupSumFn(k);
      rowTotal += cellVal;
      const td = document.createElement("td");
      td.className = "pl-value";
      td.textContent = formatCurrency(cellVal, region);
      if (cellVal < 0) td.classList.add("negative");
      tr.appendChild(td);
    });

    const tdTot = document.createElement("td");
    tdTot.className = "pl-value";
    tdTot.style.fontWeight = "var(--weight-bold)";
    tdTot.textContent = formatCurrency(rowTotal, region);
    if (rowTotal < 0) tdTot.classList.add("negative");
    tr.appendChild(tdTot);

    matrixBody.appendChild(tr);
  };

  // 2. Revenue Rows
  createPLRow(revLabel, "", k => report.data[k].revenueSum);

  // 3. Direct Costs / COGS Breakdown
  const activeCOGS = report.cogsCategories.filter(c => {
    // Only display categories that have non-zero total values across statement
    let total = 0;
    report.keys.forEach(k => total += report.data[k].cogsBreakdown[c] || 0);
    return total > 0;
  });

  activeCOGS.forEach(c => {
    createPLRow(c, "indent-1", k => report.data[k].cogsBreakdown[c] || 0);
  });

  // Total COGS Subtotal
  createPLRow(`Total ${cogsLabel}`, "subtotal", k => report.data[k].cogsSum, true);

  // Gross Profit
  createPLRow(grossLabel, "subtotal", k => {
    const rev = report.data[k].revenueSum;
    const cogs = report.data[k].cogsSum;
    return rev - cogs;
  }, true);

  // 4. Operating Expenses
  const activeOPEX = report.opexCategories.filter(o => {
    let total = 0;
    report.keys.forEach(k => total += report.data[k].opexBreakdown[o] || 0);
    return total > 0;
  });

  activeOPEX.forEach(o => {
    createPLRow(o, "indent-1", k => report.data[k].opexBreakdown[o] || 0);
  });

  // Total OPEX Subtotal
  createPLRow("Total Operating Expenses", "subtotal", k => report.data[k].opexSum, true);

  // Operating Income (EBITDA)
  createPLRow("Operating Income (EBITDA)", "subtotal", k => {
    const rev = report.data[k].revenueSum;
    const cogs = report.data[k].cogsSum;
    const opex = report.data[k].opexSum;
    return (rev - cogs) - opex;
  }, true);

  // 5. Taxes & Interest (accumulated VAT/GST)
  createPLRow("Taxes & Interest", "", k => report.data[k].taxSum);

  // 6. Net Profit / Net Income
  createPLRow(netLabel, "grand-total", k => {
    const rev = report.data[k].revenueSum;
    const cogs = report.data[k].cogsSum;
    const opex = report.data[k].opexSum;
    const tax = report.data[k].taxSum;
    return (rev - cogs) - opex - tax;
  }, false, true);
}

function renderPLCharts(report) {
  // Destroy existing charts to reload clean data
  if (state.chartInstances.performanceChart) {
    state.chartInstances.performanceChart.destroy();
  }
  if (state.chartInstances.expenseBreakdownChart) {
    state.chartInstances.expenseBreakdownChart.destroy();
  }

  const performanceCtx = document.getElementById("performanceChart").getContext("2d");
  const breakdownCtx = document.getElementById("breakdownChart").getContext("2d");

  // Datasets for performance
  const labels = report.keys.map(formatGroupKey);
  const revenueData = [];
  const expenseData = [];
  const netData = [];

  // Grouped datasets
  report.keys.forEach(k => {
    const d = report.data[k];
    const gross = d.revenueSum - d.cogsSum;
    const net = gross - d.opexSum - d.taxSum;

    revenueData.push(d.revenueSum);
    expenseData.push(d.cogsSum + d.opexSum);
    netData.push(net);
  });

  // 1. Grouped Performance Bar Chart
  state.chartInstances.performanceChart = new Chart(performanceCtx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: state.onboarding.region === "United States" ? "Revenue" : "Turnover",
          data: revenueData,
          backgroundColor: '#2ea349', // Success
          borderColor: '#2ea349',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: "Total Expenses",
          data: expenseData,
          backgroundColor: '#d68529', // Warning
          borderColor: '#d68529',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: state.onboarding.region === "United States" ? "Net Income" : "Net Profit",
          data: netData,
          type: 'line',
          borderColor: '#216be4', // Primary
          backgroundColor: 'transparent',
          pointBackgroundColor: '#216be4',
          tension: 0.1,
          borderWidth: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: { family: 'Figtree' }
          },
          grid: { color: 'rgba(16, 22, 33, 0.05)' }
        },
        x: {
          ticks: {
            font: { family: 'Figtree' }
          },
          grid: { display: false }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { family: 'Figtree', weight: '500' } }
        }
      }
    }
  });

  // 2. Expense Category Breakdown Doughnut Chart
  const expenseCategories = {};
  
  // Aggregate all COGS & OPEX category sums across all keys
  report.keys.forEach(k => {
    const d = report.data[k];
    
    // COGS
    Object.keys(d.cogsBreakdown).forEach(c => {
      const val = d.cogsBreakdown[c];
      if (val > 0) {
        expenseCategories[c] = (expenseCategories[c] || 0) + val;
      }
    });

    // OPEX
    Object.keys(d.opexBreakdown).forEach(o => {
      const val = d.opexBreakdown[o];
      if (val > 0) {
        expenseCategories[o] = (expenseCategories[o] || 0) + val;
      }
    });
  });

  const breakdownLabels = Object.keys(expenseCategories);
  const breakdownValues = Object.values(expenseCategories);

  // Palette colors for mapping
  const palette = [
    '#216be4', // Primary
    '#77259d', // Secondary
    '#7b7900', // Tertiary
    '#00affa', // Info
    '#d68529', // Warning
    '#2ea349', // Success
    '#c487e7', // Secondary hover
    '#ff7069'  // Error focus
  ];

  state.chartInstances.expenseBreakdownChart = new Chart(breakdownCtx, {
    type: 'doughnut',
    data: {
      labels: breakdownLabels,
      datasets: [{
        data: breakdownValues,
        backgroundColor: palette.slice(0, breakdownLabels.length),
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            font: { family: 'Figtree', size: 11 }
          }
        }
      },
      cutout: '60%'
    }
  });
}

// ==========================================
// DEMO DATA CONTROLLERS & WORKFLOW TRIGGERS
// ==========================================

function handleOnboardingVatToggle() {
  const checkEl = document.getElementById("profile-vat-extract");
  const rateBox = document.getElementById("profile-vat-rate-box");
  if (checkEl.checked) {
    rateBox.classList.remove("d-none");
  } else {
    rateBox.classList.add("d-none");
  }
}

function handleRegionSelectionChange() {
  const region = document.getElementById("profile-region").value;
  const vatContainer = document.getElementById("profile-vat-container");
  const vatRateInput = document.getElementById("profile-vat-rate");
  const checkboxVat = document.getElementById("profile-vat-extract");

  if (region === "United States") {
    // US has no standard national VAT/GST
    vatContainer.classList.add("d-none");
    checkboxVat.checked = false;
    handleOnboardingVatToggle();
  } else {
    vatContainer.classList.remove("d-none");
    if (region === "United Kingdom") {
      vatRateInput.value = 20;
    } else if (region === "Australia" || region === "South Africa") {
      vatRateInput.value = 15;
    }
  }
}

function loadDemoData() {
  const industry = document.getElementById("profile-industry").value;
  const csvText = window.demoData[industry];

  if (!csvText) {
    alert("No demo data available for industry: " + industry);
    return;
  }

  state.csvData.fileName = `demo_${industry.toLowerCase().replace(/[^a-z0-9]/g, '_')}_bank_statement.csv`;
  
  const success = processCSVContent(csvText);
  if (success) {
    renderSchemaPreview();
    showStep("step-schema");
  }
}

function handleCsvFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  state.csvData.fileName = file.name;

  const reader = new FileReader();
  reader.onload = function(e) {
    const success = processCSVContent(e.target.result);
    if (success) {
      renderSchemaPreview();
      showStep("step-schema");
    }
  };
  reader.readAsText(file);
}

// Drag & drop triggers
function setupDragAndDrop() {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("csv-file-input");

  if (!dropZone) return;

  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");

    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.csv') || file.type === "text/csv") {
        state.csvData.fileName = file.name;
        const reader = new FileReader();
        reader.onload = function(evt) {
          const success = processCSVContent(evt.target.result);
          if (success) {
            renderSchemaPreview();
            showStep("step-schema");
          }
        };
        reader.readAsText(file);
      } else {
        alert("Please drop a valid CSV bank statement file.");
      }
    }
  });
}

// Toggle aggregation (monthly vs quarterly)
function setTimeAggregation(mode) {
  state.timeAggregation = mode;
  
  const btnMonthly = document.getElementById("agg-monthly");
  const btnQuarterly = document.getElementById("agg-quarterly");

  if (mode === "monthly") {
    btnMonthly.className = "btn btn-secondary";
    btnMonthly.style.backgroundColor = "var(--primary-background-subtle)";
    btnMonthly.style.color = "var(--primary-background-default)";
    btnQuarterly.className = "btn btn-secondary";
    btnQuarterly.style.backgroundColor = "transparent";
    btnQuarterly.style.color = "var(--neutral-text-default)";
  } else {
    btnQuarterly.className = "btn btn-secondary";
    btnQuarterly.style.backgroundColor = "var(--primary-background-subtle)";
    btnQuarterly.style.color = "var(--primary-background-default)";
    btnMonthly.className = "btn btn-secondary";
    btnMonthly.style.backgroundColor = "transparent";
    btnMonthly.style.color = "var(--neutral-text-default)";
  }

  // Regenerate P&L Matrix and Charts
  generatePLStatement();
}

// Toggle dashboard tab (table vs charts)
function switchDashboardTab(tabName) {
  state.dashboardTab = tabName;

  const btnTable = document.getElementById("tab-trigger-table");
  const btnCharts = document.getElementById("tab-trigger-charts");

  const paneTable = document.getElementById("tab-pane-table");
  const paneCharts = document.getElementById("tab-pane-charts");

  if (tabName === "table") {
    btnTable.classList.add("active");
    btnCharts.classList.remove("active");
    paneTable.classList.add("active");
    paneCharts.classList.remove("active");
  } else {
    btnCharts.classList.add("active");
    btnTable.classList.remove("active");
    paneCharts.classList.add("active");
    paneTable.classList.remove("active");
  }
}

// Export P&L report as PDF / print triggers
function triggerReportExport() {
  window.print();
}

// Initialize Application UI binding
document.addEventListener("DOMContentLoaded", () => {
  // Bind step actions
  document.getElementById("btn-submit-onboarding").addEventListener("click", saveOnboardingProfile);
  document.getElementById("btn-use-demo").addEventListener("click", loadDemoData);
  document.getElementById("csv-file-input").addEventListener("change", handleCsvFileUpload);
  
  document.getElementById("schema-date-col").addEventListener("change", updateSchemaTablePreview);
  document.getElementById("schema-desc-col").addEventListener("change", updateSchemaTablePreview);
  document.getElementById("schema-amount-col").addEventListener("change", updateSchemaTablePreview);

  document.getElementById("btn-confirm-schema").addEventListener("click", confirmSchemaAlignment);
  document.getElementById("btn-generate-pl").addEventListener("click", generatePLStatement);

  document.getElementById("profile-region").addEventListener("change", handleRegionSelectionChange);
  document.getElementById("profile-vat-extract").addEventListener("change", handleOnboardingVatToggle);

  document.getElementById("agg-monthly").addEventListener("click", () => setTimeAggregation("monthly"));
  document.getElementById("agg-quarterly").addEventListener("click", () => setTimeAggregation("quarterly"));

  document.getElementById("tab-trigger-table").addEventListener("click", () => switchDashboardTab("table"));
  document.getElementById("tab-trigger-charts").addEventListener("click", () => switchDashboardTab("charts"));

  document.getElementById("btn-export").addEventListener("click", triggerReportExport);

  // Set default button layout style for aggregation
  setTimeAggregation("monthly");

  // Initialize selected region localization terms
  handleRegionSelectionChange();

  // Set drag zone drop
  setupDragAndDrop();

  // Show onboarding
  showStep("step-onboarding");
});
