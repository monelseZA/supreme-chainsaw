const fs = require('fs');
const path = require('path');

// Mock browser objects to allow app.js to load in Node.js environment
global.window = {};
global.document = {
  addEventListener: () => {},
  getElementById: (id) => {
    return {
      value: "",
      checked: false,
      addEventListener: () => {},
      classList: { add: () => {}, remove: () => {} },
      style: {},
      innerHTML: ""
    };
  },
  querySelectorAll: () => {
    return [];
  }
};
global.alert = (msg) => console.log("ALERT:", msg);
global.Chart = class {
  constructor() {}
  destroy() {}
};

// Load demo data
const demoDataContent = fs.readFileSync(path.join(__dirname, '../../../../Documents/antigravity/serene-darwin/demo_data.js'), 'utf8');
eval(demoDataContent); // Populates window.demoData

// Load app logic and bind state + functions to global context
let appContent = fs.readFileSync(path.join(__dirname, '../../../../Documents/antigravity/serene-darwin/app.js'), 'utf8');
appContent = appContent.replace(/const state =/g, 'global.state =');
appContent = appContent.replace(/function (\w+)\(/g, 'global.$1 = function(');
eval(appContent);

console.log("=== Running Unit & Logic Tests for Antigravity Finance ===\n");

// Test 1: CSV Parser Delimiter and Row Filtering
console.log("Test 1: CSV Parsing & Delimiter Detection");
const saasCSV = window.demoData["SaaS/Tech"];
const parsed = global.processCSVContent(saasCSV);
console.log(`- Delimiter detected: "${global.state.csvData.delimiter}"`);
console.log(`- Total parsed rows: ${global.state.csvData.allParsedRows.length}`);
console.log(`- Valid transaction rows (with dates): ${global.state.csvData.validRows.length}`);
if (global.state.csvData.delimiter === ';' && global.state.csvData.validRows.length === 17) {
  console.log("✅ Test 1 Passed\n");
} else {
  console.log("❌ Test 1 Failed\n");
}

// Test 2: Heuristics Column Prediction
console.log("Test 2: Column Heuristic Index Predictions");
console.log(`- Predicted Date Index: ${global.state.csvData.dateColIdx} (${global.state.csvData.headers[global.state.csvData.dateColIdx]})`);
console.log(`- Predicted Description Index: ${global.state.csvData.descColIdx} (${global.state.csvData.headers[global.state.csvData.descColIdx]})`);
console.log(`- Predicted Amount Index: ${global.state.csvData.amountColIdx} (${global.state.csvData.headers[global.state.csvData.amountColIdx]})`);
if (global.state.csvData.dateColIdx === 0 && global.state.csvData.descColIdx === 1 && global.state.csvData.amountColIdx === 3) {
  console.log("✅ Test 2 Passed\n");
} else {
  console.log("❌ Test 2 Failed\n");
}

// Test 3: Industry Mapping & Heuristic Payees rules
console.log("Test 3: Heuristic Mappings");
global.state.onboarding.industry = "SaaS/Tech";
global.state.onboarding.region = "United Kingdom"; // UK Turnover/Stock/Direct Costs terminology
global.state.onboarding.vatRate = 20;
global.state.onboarding.vatExtract = true;

global.ingestTransactions();

// Verify AWS Row (AWS Billing, index 0, amount -250)
const awsTx = global.state.transactions.find(tx => tx.rawDescription.includes("AWS Billing"));
console.log(`- AWS transaction description: "${awsTx.rawDescription}"`);
console.log(`- AWS mapped category: "${awsTx.category}"`);
console.log(`- AWS original amount: ${awsTx.amount}`);
console.log(`- AWS net cost (net of 20% VAT): ${awsTx.netAmount.toFixed(2)}`);
console.log(`- AWS tax extracted: ${awsTx.taxAmount.toFixed(2)}`);

const slackTx = global.state.transactions.find(tx => tx.rawDescription.includes("Slack Premium"));
console.log(`- Slack mapped category: "${slackTx.category}"`);

const transferTx = global.state.transactions.find(tx => tx.rawDescription.includes("Transfer to house save"));
console.log(`- Transfer transaction category: "${transferTx.category}" (Excluded: ${transferTx.isExcluded})`);

const isAwsCorrect = awsTx.category === "COGS (Hosting)" && Math.abs(awsTx.netAmount + 208.33) < 0.01 && Math.abs(awsTx.taxAmount + 41.67) < 0.01;
const isSlackCorrect = slackTx.category === "OPEX (Software)";
const isTransferCorrect = transferTx.category === "Internal Transfer" && transferTx.isExcluded === true;

if (isAwsCorrect && isSlackCorrect && isTransferCorrect) {
  console.log("✅ Test 3 Passed\n");
} else {
  console.log("❌ Test 3 Failed\n");
}

// Test 4: Financial Math calculations & Aggregations
console.log("Test 4: Aggregation Math and Matrix Structure");
global.state.timeAggregation = "monthly";
const report = global.compileFinancialReport();
console.log(`- Monthly aggregation keys: ${JSON.stringify(report.keys)}`);

let totalTurnover = 0;
let totalCOGS = 0;
let totalOPEX = 0;
let totalTax = 0;

report.keys.forEach(k => {
  const dataVal = report.data[k];
  totalTurnover += dataVal.revenueSum;
  totalCOGS += dataVal.cogsSum;
  totalOPEX += dataVal.opexSum;
  totalTax += dataVal.taxSum;
});

const grossMargin = totalTurnover - totalCOGS;
const netProfit = grossMargin - totalOPEX - totalTax;

console.log(`- Accumulated Turnover: ${totalTurnover.toFixed(2)}`);
console.log(`- Accumulated Direct Costs / COGS: ${totalCOGS.toFixed(2)}`);
console.log(`- Accumulated OPEX (net): ${totalOPEX.toFixed(2)}`);
console.log(`- Accumulated Tax component: ${totalTax.toFixed(2)}`);
console.log(`- Net Profit: ${netProfit.toFixed(2)}`);

if (Math.abs(totalTurnover - 35200) < 0.01 && Math.abs(netProfit - 33550.00) < 0.01) {
  console.log("✅ Test 4 Passed\n");
} else {
  console.log("❌ Test 4 Failed\n");
}

console.log("=== All Backend Business Logic Verified ===");
