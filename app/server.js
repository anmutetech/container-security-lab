const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const helmet = require('helmet');
const client = require('prom-client');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Prometheus Metrics
// ---------------------------------------------------------------------------
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const transactionsProcessedTotal = new client.Counter({
  name: 'transactions_processed_total',
  help: 'Total number of transactions processed',
  labelNames: ['status'],
  registers: [register],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Middleware to record request metrics
app.use((req, res, next) => {
  const end = httpRequestDurationSeconds.startTimer({
    method: req.method,
    route: req.path,
  });
  res.on('finish', () => {
    httpRequestsTotal.inc({
      method: req.method,
      route: req.path,
      status: res.statusCode,
    });
    end();
  });
  next();
});

// ---------------------------------------------------------------------------
// Sample Transaction Data
// ---------------------------------------------------------------------------
const sampleTransactions = [
  {
    id: 'txn-a1b2c3d4',
    cardNumber: '****-****-****-4532',
    merchant: 'Cloud Nine Coffee',
    amount: 5.75,
    currency: 'USD',
    status: 'approved',
    timestamp: '2026-03-25T08:12:33Z',
  },
  {
    id: 'txn-e5f6g7h8',
    cardNumber: '****-****-****-8821',
    merchant: 'TechMart Electronics',
    amount: 249.99,
    currency: 'USD',
    status: 'approved',
    timestamp: '2026-03-25T09:45:10Z',
  },
  {
    id: 'txn-i9j0k1l2',
    cardNumber: '****-****-****-3347',
    merchant: 'FreshBite Groceries',
    amount: 87.32,
    currency: 'USD',
    status: 'approved',
    timestamp: '2026-03-25T10:03:55Z',
  },
  {
    id: 'txn-m3n4o5p6',
    cardNumber: '****-****-****-9910',
    merchant: 'Nomad Travel Agency',
    amount: 1250.0,
    currency: 'EUR',
    status: 'pending',
    timestamp: '2026-03-25T11:30:22Z',
  },
  {
    id: 'txn-q7r8s9t0',
    cardNumber: '****-****-****-5564',
    merchant: 'UrbanFit Gym',
    amount: 49.99,
    currency: 'USD',
    status: 'approved',
    timestamp: '2026-03-25T12:15:08Z',
  },
  {
    id: 'txn-u1v2w3x4',
    cardNumber: '****-****-****-2278',
    merchant: 'BookHaven Online',
    amount: 34.5,
    currency: 'GBP',
    status: 'declined',
    timestamp: '2026-03-25T13:42:17Z',
  },
  {
    id: 'txn-y5z6a7b8',
    cardNumber: '****-****-****-6643',
    merchant: 'PetPals Supplies',
    amount: 62.1,
    currency: 'USD',
    status: 'approved',
    timestamp: '2026-03-25T14:08:44Z',
  },
  {
    id: 'txn-c9d0e1f2',
    cardNumber: '****-****-****-1195',
    merchant: 'Streamline SaaS',
    amount: 299.0,
    currency: 'USD',
    status: 'approved',
    timestamp: '2026-03-25T15:55:30Z',
  },
  {
    id: 'txn-g3h4i5j6',
    cardNumber: '****-****-****-7756',
    merchant: 'QuickBite Delivery',
    amount: 18.9,
    currency: 'USD',
    status: 'pending',
    timestamp: '2026-03-25T16:20:11Z',
  },
  {
    id: 'txn-k7l8m9n0',
    cardNumber: '****-****-****-3389',
    merchant: 'GreenLeaf Pharmacy',
    amount: 42.75,
    currency: 'USD',
    status: 'declined',
    timestamp: '2026-03-25T17:33:59Z',
  },
];

// In-memory store for new transactions
const transactions = [...sampleTransactions];

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'VaultPay Payment Gateway',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// List all transactions
app.get('/api/transactions', (req, res) => {
  res.json({
    count: transactions.length,
    transactions,
  });
});

// Get a single transaction by ID
app.get('/api/transactions/:id', (req, res) => {
  const txn = transactions.find((t) => t.id === req.params.id);
  if (!txn) {
    return res.status(404).json({ error: 'Transaction not found' });
  }
  res.json(txn);
});

// Process a new transaction
app.post('/api/transactions', (req, res) => {
  const { cardNumber, merchant, amount, currency } = req.body;

  // Validate required fields
  if (!cardNumber || !merchant || !amount) {
    transactionsProcessedTotal.inc({ status: 'rejected' });
    return res.status(400).json({
      error: 'Missing required fields: cardNumber, merchant, amount',
    });
  }

  // Validate amount
  if (typeof amount !== 'number' || amount <= 0) {
    transactionsProcessedTotal.inc({ status: 'rejected' });
    return res.status(400).json({
      error: 'Amount must be a positive number',
    });
  }

  // Validate card number format (basic check: 13-19 digits, with or without dashes)
  const digitsOnly = String(cardNumber).replace(/-/g, '');
  if (!/^\d{13,19}$/.test(digitsOnly)) {
    transactionsProcessedTotal.inc({ status: 'rejected' });
    return res.status(400).json({
      error: 'Invalid card number format. Expected 13-19 digits.',
    });
  }

  // Mask the card number for storage
  const maskedCard = '****-****-****-' + digitsOnly.slice(-4);

  const newTransaction = {
    id: 'txn-' + uuidv4().slice(0, 8),
    cardNumber: maskedCard,
    merchant,
    amount,
    currency: currency || 'USD',
    status: 'approved',
    timestamp: new Date().toISOString(),
  };

  transactions.push(newTransaction);
  transactionsProcessedTotal.inc({ status: 'approved' });

  res.status(201).json(newTransaction);
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`VaultPay Payment Gateway running on port ${PORT}`);
  });
}

module.exports = app;
