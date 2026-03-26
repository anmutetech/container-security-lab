const request = require('supertest');
const app = require('../server');

describe('VaultPay Payment Gateway', () => {
  describe('GET /health', () => {
    it('should return service health info', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.service).toBe('VaultPay Payment Gateway');
      expect(res.body.status).toBe('healthy');
      expect(res.body.version).toBe('1.0.0');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('GET /api/transactions', () => {
    it('should return all sample transactions', async () => {
      const res = await request(app).get('/api/transactions');
      expect(res.statusCode).toBe(200);
      expect(res.body.count).toBe(10);
      expect(res.body.transactions).toHaveLength(10);
    });

    it('should return transactions with expected fields', async () => {
      const res = await request(app).get('/api/transactions');
      const txn = res.body.transactions[0];
      expect(txn).toHaveProperty('id');
      expect(txn).toHaveProperty('cardNumber');
      expect(txn).toHaveProperty('merchant');
      expect(txn).toHaveProperty('amount');
      expect(txn).toHaveProperty('currency');
      expect(txn).toHaveProperty('status');
      expect(txn).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/transactions/:id', () => {
    it('should return a specific transaction', async () => {
      const res = await request(app).get('/api/transactions/txn-a1b2c3d4');
      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe('txn-a1b2c3d4');
      expect(res.body.merchant).toBe('Cloud Nine Coffee');
    });

    it('should return 404 for unknown transaction', async () => {
      const res = await request(app).get('/api/transactions/txn-nonexistent');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Transaction not found');
    });
  });

  describe('POST /api/transactions', () => {
    it('should create a new transaction with masked card number', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .send({
          cardNumber: '4111111111111111',
          merchant: 'Test Store',
          amount: 49.99,
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.cardNumber).toBe('****-****-****-1111');
      expect(res.body.merchant).toBe('Test Store');
      expect(res.body.amount).toBe(49.99);
      expect(res.body.currency).toBe('USD');
      expect(res.body.status).toBe('approved');
      expect(res.body.id).toMatch(/^txn-/);
    });

    it('should accept a custom currency', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .send({
          cardNumber: '5500000000000004',
          merchant: 'Euro Shop',
          amount: 100,
          currency: 'EUR',
        });
      expect(res.statusCode).toBe(201);
      expect(res.body.currency).toBe('EUR');
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .send({ merchant: 'Test' });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/Missing required fields/);
    });

    it('should return 400 for non-positive amount', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .send({
          cardNumber: '4111111111111111',
          merchant: 'Test',
          amount: -10,
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/positive number/);
    });

    it('should return 400 for invalid card number format', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .send({
          cardNumber: 'abc',
          merchant: 'Test',
          amount: 10,
        });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/Invalid card number/);
    });
  });

  describe('GET /metrics', () => {
    it('should return Prometheus metrics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('http_requests_total');
      expect(res.text).toContain('transactions_processed_total');
    });
  });
});
