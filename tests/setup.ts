// tests set env values here before app modules load
// do not load local .env or tests may hit a real MongoDB
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://placeholder.invalid:27017/test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.POLYGON_RPC_URL = process.env.POLYGON_RPC_URL ?? 'http://localhost:0';
process.env.ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL ?? 'http://localhost:0';
