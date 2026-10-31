import type { Sector, WatchlistEntry } from "./types";

/**
 * Curated, liquid Nifty 200 constituents. Edit freely — symbols that fail to
 * load (delisted, renamed) are skipped at scan time rather than breaking it.
 */
const RAW: ReadonlyArray<readonly [symbol: string, name: string, sector: Sector]> = [
  // IT — the sectors most exposed to the overnight Nasdaq move
  ["TCS", "Tata Consultancy Services", "IT"],
  ["INFY", "Infosys", "IT"],
  ["HCLTECH", "HCL Technologies", "IT"],
  ["WIPRO", "Wipro", "IT"],
  ["TECHM", "Tech Mahindra", "IT"],
  ["LTIM", "LTIMindtree", "IT"],
  ["PERSISTENT", "Persistent Systems", "IT"],
  ["COFORGE", "Coforge", "IT"],
  ["MPHASIS", "Mphasis", "IT"],
  // Banks
  ["HDFCBANK", "HDFC Bank", "Banking"],
  ["ICICIBANK", "ICICI Bank", "Banking"],
  ["SBIN", "State Bank of India", "Banking"],
  ["KOTAKBANK", "Kotak Mahindra Bank", "Banking"],
  ["AXISBANK", "Axis Bank", "Banking"],
  ["INDUSINDBK", "IndusInd Bank", "Banking"],
  ["BANKBARODA", "Bank of Baroda", "Banking"],
  ["PNB", "Punjab National Bank", "Banking"],
  ["CANBK", "Canara Bank", "Banking"],
  ["FEDERALBNK", "Federal Bank", "Banking"],
  ["AUBANK", "AU Small Finance Bank", "Banking"],
  // Financials
  ["BAJFINANCE", "Bajaj Finance", "Financials"],
  ["BAJAJFINSV", "Bajaj Finserv", "Financials"],
  ["SHRIRAMFIN", "Shriram Finance", "Financials"],
  ["CHOLAFIN", "Cholamandalam Investment & Finance", "Financials"],
  ["MUTHOOTFIN", "Muthoot Finance", "Financials"],
  ["SBILIFE", "SBI Life Insurance", "Financials"],
  ["HDFCLIFE", "HDFC Life Insurance", "Financials"],
  ["PFC", "Power Finance Corporation", "Financials"],
  ["RECLTD", "REC Limited", "Financials"],
  ["JIOFIN", "Jio Financial Services", "Financials"],
  // Energy & utilities
  ["RELIANCE", "Reliance Industries", "Energy"],
  ["ONGC", "Oil & Natural Gas Corporation", "Energy"],
  ["BPCL", "Bharat Petroleum", "Energy"],
  ["IOC", "Indian Oil Corporation", "Energy"],
  ["NTPC", "NTPC", "Energy"],
  ["POWERGRID", "Power Grid Corporation of India", "Energy"],
  ["TATAPOWER", "Tata Power", "Energy"],
  ["GAIL", "GAIL (India)", "Energy"],
  ["COALINDIA", "Coal India", "Energy"],
  // Auto
  ["MARUTI", "Maruti Suzuki India", "Auto"],
  ["M&M", "Mahindra & Mahindra", "Auto"],
  ["BAJAJ-AUTO", "Bajaj Auto", "Auto"],
  ["HEROMOTOCO", "Hero MotoCorp", "Auto"],
  ["EICHERMOT", "Eicher Motors", "Auto"],
  ["TVSMOTOR", "TVS Motor Company", "Auto"],
  ["ASHOKLEY", "Ashok Leyland", "Auto"],
  // FMCG
  ["HINDUNILVR", "Hindustan Unilever", "FMCG"],
  ["ITC", "ITC", "FMCG"],
  ["NESTLEIND", "Nestlé India", "FMCG"],
  ["BRITANNIA", "Britannia Industries", "FMCG"],
  ["TATACONSUM", "Tata Consumer Products", "FMCG"],
  ["DABUR", "Dabur India", "FMCG"],
  ["GODREJCP", "Godrej Consumer Products", "FMCG"],
  ["VBL", "Varun Beverages", "FMCG"],
  // Pharma & healthcare
  ["SUNPHARMA", "Sun Pharmaceutical Industries", "Pharma"],
  ["DRREDDY", "Dr. Reddy's Laboratories", "Pharma"],
  ["CIPLA", "Cipla", "Pharma"],
  ["DIVISLAB", "Divi's Laboratories", "Pharma"],
  ["LUPIN", "Lupin", "Pharma"],
  ["APOLLOHOSP", "Apollo Hospitals Enterprise", "Healthcare"],
  ["MAXHEALTH", "Max Healthcare Institute", "Healthcare"],
  // Metals & mining
  ["TATASTEEL", "Tata Steel", "Metals"],
  ["JSWSTEEL", "JSW Steel", "Metals"],
  ["HINDALCO", "Hindalco Industries", "Metals"],
  ["VEDL", "Vedanta", "Metals"],
  ["JINDALSTEL", "Jindal Steel", "Metals"],
  ["NMDC", "NMDC", "Metals"],
  // Cement & infra
  ["ULTRACEMCO", "UltraTech Cement", "Cement"],
  ["GRASIM", "Grasim Industries", "Cement"],
  ["AMBUJACEM", "Ambuja Cements", "Cement"],
  ["LT", "Larsen & Toubro", "Infra"],
  ["ADANIPORTS", "Adani Ports & SEZ", "Infra"],
  ["ADANIENT", "Adani Enterprises", "Infra"],
  // Capital goods & defence
  ["SIEMENS", "Siemens", "Capital Goods"],
  ["ABB", "ABB India", "Capital Goods"],
  ["POLYCAB", "Polycab India", "Capital Goods"],
  ["HAVELLS", "Havells India", "Capital Goods"],
  ["CUMMINSIND", "Cummins India", "Capital Goods"],
  ["BHEL", "Bharat Heavy Electricals", "Capital Goods"],
  ["HAL", "Hindustan Aeronautics", "Defence"],
  ["BEL", "Bharat Electronics", "Defence"],
  // Consumer, telecom, realty, others
  ["TITAN", "Titan Company", "Consumer"],
  ["ASIANPAINT", "Asian Paints", "Consumer"],
  ["TRENT", "Trent", "Consumer"],
  ["DMART", "Avenue Supermarts", "Consumer"],
  ["DIXON", "Dixon Technologies", "Consumer"],
  ["ETERNAL", "Eternal", "Consumer"],
  ["PIDILITIND", "Pidilite Industries", "Chemicals"],
  ["SRF", "SRF", "Chemicals"],
  ["BHARTIARTL", "Bharti Airtel", "Telecom"],
  ["DLF", "DLF", "Realty"],
  ["GODREJPROP", "Godrej Properties", "Realty"],
  ["INDIGO", "InterGlobe Aviation", "Aviation"],
];

export const WATCHLIST: readonly WatchlistEntry[] = RAW.map(([symbol, name, sector]) => ({
  symbol,
  yahoo: `${symbol}.NS`,
  name,
  sector,
}));

/** Sectors whose earnings are most sensitive to US tech sentiment. */
export const NASDAQ_SENSITIVE: ReadonlySet<Sector> = new Set<Sector>(["IT"]);
