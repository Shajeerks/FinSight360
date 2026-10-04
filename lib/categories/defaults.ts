/**
 * Built-in category tree (system categories, shared by all users).
 * Users can add their own categories/subcategories on top.
 */
export type DefaultCategory = {
  name: string;
  kind: "EXPENSE" | "INCOME" | "TRANSFER";
  icon: string;
  color: string;
  isFixed?: boolean;
  subCategories: string[];
};

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: "Food", kind: "EXPENSE", icon: "utensils", color: "#f97316", subCategories: ["Restaurant", "Food Delivery", "Groceries", "Cafe"] },
  { name: "Transport", kind: "EXPENSE", icon: "car", color: "#0ea5e9", subCategories: ["Fuel", "Taxi", "Uber", "Ola", "Public Transport", "Parking & Tolls"] },
  { name: "Shopping", kind: "EXPENSE", icon: "shopping-bag", color: "#a855f7", subCategories: ["Electronics", "Clothing", "Household", "Online Shopping"] },
  { name: "Bills", kind: "EXPENSE", icon: "receipt", color: "#eab308", isFixed: true, subCategories: ["Electricity", "Internet", "Mobile", "Gas", "Water", "DTH"] },
  { name: "Entertainment", kind: "EXPENSE", icon: "clapperboard", color: "#ec4899", subCategories: ["Movies", "Subscription", "Events", "Games"] },
  { name: "Travel", kind: "EXPENSE", icon: "plane", color: "#14b8a6", subCategories: ["Flights", "Hotels", "Trains", "Holiday"] },
  { name: "Medical", kind: "EXPENSE", icon: "heart-pulse", color: "#ef4444", subCategories: ["Doctor", "Pharmacy", "Lab Tests", "Hospital"] },
  { name: "Education", kind: "EXPENSE", icon: "graduation-cap", color: "#6366f1", subCategories: ["Fees", "Books", "Courses"] },
  { name: "Insurance", kind: "EXPENSE", icon: "shield", color: "#64748b", isFixed: true, subCategories: ["Health", "Life", "Vehicle"] },
  { name: "EMI", kind: "EXPENSE", icon: "landmark", color: "#78716c", isFixed: true, subCategories: ["Home Loan", "Car Loan", "Personal Loan", "Education Loan"] },
  { name: "Investment", kind: "EXPENSE", icon: "trending-up", color: "#10b981", subCategories: ["SIP", "Stocks", "Mutual Funds", "Fixed Deposit"] },
  { name: "Rent", kind: "EXPENSE", icon: "home", color: "#8b5cf6", isFixed: true, subCategories: ["House Rent", "Maintenance"] },
  { name: "Subscriptions", kind: "EXPENSE", icon: "repeat", color: "#d946ef", subCategories: ["Streaming", "Software", "Memberships"] },
  { name: "Personal Care", kind: "EXPENSE", icon: "sparkles", color: "#f43f5e", subCategories: ["Salon", "Fitness"] },
  { name: "Fees & Charges", kind: "EXPENSE", icon: "badge-percent", color: "#94a3b8", subCategories: ["Bank Charges", "Card Fees", "Late Fees", "Interest"] },
  { name: "Other", kind: "EXPENSE", icon: "circle-ellipsis", color: "#a1a1aa", subCategories: ["Miscellaneous", "Cash Withdrawal", "Gifts", "Donations"] },
  { name: "Salary", kind: "INCOME", icon: "briefcase", color: "#22c55e", subCategories: ["Monthly Salary", "Bonus"] },
  { name: "Freelance", kind: "INCOME", icon: "laptop", color: "#16a34a", subCategories: [] },
  { name: "Business", kind: "INCOME", icon: "building", color: "#15803d", subCategories: [] },
  { name: "Rental", kind: "INCOME", icon: "key", color: "#4ade80", subCategories: [] },
  { name: "Interest", kind: "INCOME", icon: "percent", color: "#86efac", subCategories: ["Savings Interest", "FD Interest"] },
  { name: "Investment Income", kind: "INCOME", icon: "line-chart", color: "#34d399", subCategories: ["Dividends", "Capital Gains"] },
  { name: "Other Income", kind: "INCOME", icon: "plus-circle", color: "#a3e635", subCategories: ["Refunds", "Cashback", "Gifts"] },
  { name: "Transfer", kind: "TRANSFER", icon: "arrow-left-right", color: "#94a3b8", subCategories: ["Own Account", "Credit Card Payment"] },
];

export type DefaultRule = {
  pattern: string;
  matchType: "MERCHANT" | "KEYWORD";
  category: string;
  subCategory?: string;
  kind: "EXPENSE" | "INCOME";
};

export const DEFAULT_CATEGORIZATION_RULES: DefaultRule[] = [
  { pattern: "SWIGGY", matchType: "MERCHANT", category: "Food", subCategory: "Food Delivery", kind: "EXPENSE" },
  { pattern: "ZOMATO", matchType: "MERCHANT", category: "Food", subCategory: "Food Delivery", kind: "EXPENSE" },
  { pattern: "BIGBASKET", matchType: "MERCHANT", category: "Food", subCategory: "Groceries", kind: "EXPENSE" },
  { pattern: "BLINKIT", matchType: "MERCHANT", category: "Food", subCategory: "Groceries", kind: "EXPENSE" },
  { pattern: "ZEPTO", matchType: "MERCHANT", category: "Food", subCategory: "Groceries", kind: "EXPENSE" },
  { pattern: "STARBUCKS", matchType: "MERCHANT", category: "Food", subCategory: "Cafe", kind: "EXPENSE" },
  { pattern: "UBER", matchType: "MERCHANT", category: "Transport", subCategory: "Taxi", kind: "EXPENSE" },
  { pattern: "OLA", matchType: "MERCHANT", category: "Transport", subCategory: "Taxi", kind: "EXPENSE" },
  { pattern: "RAPIDO", matchType: "MERCHANT", category: "Transport", subCategory: "Taxi", kind: "EXPENSE" },
  { pattern: "FUEL", matchType: "KEYWORD", category: "Transport", subCategory: "Fuel", kind: "EXPENSE" },
  { pattern: "PETROL", matchType: "KEYWORD", category: "Transport", subCategory: "Fuel", kind: "EXPENSE" },
  { pattern: "NETFLIX", matchType: "MERCHANT", category: "Entertainment", subCategory: "Subscription", kind: "EXPENSE" },
  { pattern: "SPOTIFY", matchType: "MERCHANT", category: "Entertainment", subCategory: "Subscription", kind: "EXPENSE" },
  { pattern: "HOTSTAR", matchType: "MERCHANT", category: "Entertainment", subCategory: "Subscription", kind: "EXPENSE" },
  { pattern: "BOOKMYSHOW", matchType: "MERCHANT", category: "Entertainment", subCategory: "Movies", kind: "EXPENSE" },
  { pattern: "AMAZON", matchType: "MERCHANT", category: "Shopping", subCategory: "Online Shopping", kind: "EXPENSE" },
  { pattern: "FLIPKART", matchType: "MERCHANT", category: "Shopping", subCategory: "Online Shopping", kind: "EXPENSE" },
  { pattern: "MYNTRA", matchType: "MERCHANT", category: "Shopping", subCategory: "Clothing", kind: "EXPENSE" },
  { pattern: "ELECTRICITY", matchType: "KEYWORD", category: "Bills", subCategory: "Electricity", kind: "EXPENSE" },
  { pattern: "BESCOM", matchType: "MERCHANT", category: "Bills", subCategory: "Electricity", kind: "EXPENSE" },
  { pattern: "AIRTEL", matchType: "MERCHANT", category: "Bills", subCategory: "Mobile", kind: "EXPENSE" },
  { pattern: "JIO", matchType: "MERCHANT", category: "Bills", subCategory: "Mobile", kind: "EXPENSE" },
  { pattern: "ACT FIBERNET", matchType: "MERCHANT", category: "Bills", subCategory: "Internet", kind: "EXPENSE" },
  { pattern: "APOLLO", matchType: "MERCHANT", category: "Medical", subCategory: "Pharmacy", kind: "EXPENSE" },
  { pattern: "PHARMEASY", matchType: "MERCHANT", category: "Medical", subCategory: "Pharmacy", kind: "EXPENSE" },
  { pattern: "MAKEMYTRIP", matchType: "MERCHANT", category: "Travel", subCategory: "Flights", kind: "EXPENSE" },
  { pattern: "IRCTC", matchType: "MERCHANT", category: "Travel", subCategory: "Trains", kind: "EXPENSE" },
  { pattern: "SALARY", matchType: "KEYWORD", category: "Salary", subCategory: "Monthly Salary", kind: "INCOME" },
];
