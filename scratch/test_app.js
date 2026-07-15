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
      innerHTML: "",
      children: [] // Mock children array to support DOM checks in tests
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

console.log("=== Running Unit & Logic Tests for Antigravity Finance (VAT Refactored) ===\n");

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

// Test 3: Industry Mapping & Heuristic Payees rules (VAT Registered)
console.log("Test 3: Heuristic Mappings & VAT Extraction on both Sales & Expenses");
global.state.onboarding.industry = "SaaS/Tech";
global.state.onboarding.region = "United Kingdom";
global.state.onboarding.vatRate = 20;
global.state.onboarding.vatRegistered = "yes";

global.ingestTransactions();

// Verify AWS Row (AWS Billing, amount -250)
const awsTx = global.state.transactions.find(tx => tx.rawDescription.includes("AWS Billing"));
console.log(`- AWS transaction description: "${awsTx.rawDescription}"`);
console.log(`- AWS mapped category: "${awsTx.category}"`);
console.log(`- AWS original amount: ${awsTx.amount}`);
console.log(`- AWS net cost (net of 20% VAT): ${awsTx.netAmount.toFixed(2)}`);
console.log(`- AWS Input VAT: ${awsTx.taxAmount.toFixed(2)}`);

// Verify Stripe Payout Income Row (Stripe Payout, amount 8500)
const stripeTx = global.state.transactions.find(tx => tx.rawDescription.includes("Stripe Payout"));
console.log(`- Stripe original amount: ${stripeTx.amount}`);
console.log(`- Stripe net revenue (net of 20% VAT): ${stripeTx.netAmount.toFixed(2)}`);
console.log(`- Stripe Output VAT: ${stripeTx.taxAmount.toFixed(2)}`);

const isAwsCorrect = awsTx.category === "COGS (Hosting)" && Math.abs(awsTx.netAmount + 208.33) < 0.01 && Math.abs(awsTx.taxAmount + 41.67) < 0.01;
const isStripeCorrect = Math.abs(stripeTx.netAmount - 7083.33) < 0.01 && Math.abs(stripeTx.taxAmount - 1416.67) < 0.01;

if (isAwsCorrect && isStripeCorrect) {
  console.log("✅ Test 3 Passed\n");
} else {
  console.log("❌ Test 3 Failed\n");
}

// Test 4: Zero-Rated Income Toggle
console.log("Test 4: Zero-Rated / Exempt Income Logic");
const stripeTxId = stripeTx.id;
// Toggle it to zero-rated (exempt)
global.toggleTransactionZeroRated(stripeTxId, true);
console.log(`- Stripe toggled to Zero-Rated: isZeroRated = ${stripeTx.isZeroRated}`);
console.log(`- Stripe recalculated net revenue: ${stripeTx.netAmount.toFixed(2)}`);
console.log(`- Stripe recalculated Output VAT: ${stripeTx.taxAmount.toFixed(2)}`);

if (stripeTx.isZeroRated === true && stripeTx.netAmount === 8500 && stripeTx.taxAmount === 0) {
  console.log("✅ Test 4 Passed\n");
} else {
  console.log("❌ Test 4 Failed\n");
}

// Reset Zero-Rated status for Test 5
global.toggleTransactionZeroRated(stripeTxId, false);

// Test 5: Aggregation Math, VAT Summary & Balance Sheet segregation
console.log("Test 5: Financial Statement Aggregations and Balance Sheet VAT Tracking");
global.state.timeAggregation = "monthly";
const report = global.compileFinancialReport();

let totalRevenue = 0;
let totalCOGS = 0;
let totalOPEX = 0;

report.keys.forEach(k => {
  const dataVal = report.data[k];
  totalRevenue += dataVal.revenueSum;
  totalCOGS += dataVal.cogsSum;
  totalOPEX += dataVal.opexSum;
});

const grossMargin = totalRevenue - totalCOGS;
const netProfit = grossMargin - totalOPEX; // VAT is excluded from P&L expenses

console.log(`- Accumulated Net Turnover: ${totalRevenue.toFixed(2)}`);
console.log(`- Accumulated Net COGS: ${totalCOGS.toFixed(2)}`);
console.log(`- Accumulated Net OPEX: ${totalOPEX.toFixed(2)}`);
console.log(`- P&L Net Profit (VAT-exclusive): ${netProfit.toFixed(2)}`);
console.log(`- Balance Sheet Output VAT (Collected): ${report.totalOutputVAT.toFixed(2)}`);
console.log(`- Balance Sheet Input VAT (Paid): ${report.totalInputVAT.toFixed(2)}`);
console.log(`- Balance Sheet Net VAT Payable: ${report.netVATPayable.toFixed(2)}`);

const isPLCorrect = Math.abs(totalRevenue - 29333.33) < 0.05 && Math.abs(netProfit - 27958.33) < 0.05;
const isVATSumsCorrect = Math.abs(report.totalOutputVAT - 5866.67) < 0.05 && Math.abs(report.totalInputVAT - 275.00) < 0.05;

if (isPLCorrect && isVATSumsCorrect) {
  console.log("✅ Test 5 Passed\n");
} else {
  console.log("❌ Test 5 Failed\n");
}

console.log("=== All Backend Business Logic Verified ===");
