import { describe, it, expect } from 'vitest';
import { parseStatement } from '../src/engine/csv.js';

const pick = (rows) => rows.map(({ date, amount, description }) => [date, amount, description]);

describe('UK bank statement formats', () => {
  it('Lloyds / Halifax: debit and credit columns', () => {
    const r = parseStatement("Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance\n02/09/2026,DEB,'30-12-34,12345678,TESCO STORES 2041,23.40,,1000.00\n01/09/2026,BGC,'30-12-34,12345678,ACME LTD SALARY,,2850.00,1023.40\n");
    expect(r.bank).toBe('lloyds');
    expect(pick(r.rows)).toEqual([['2026-09-02', -23.4, 'TESCO STORES 2041'], ['2026-09-01', 2850, 'ACME LTD SALARY']]);
  });

  it('HSBC: header-less date, description, signed amount', () => {
    const r = parseStatement('02/09/2026,TESCO STORES 2041,-23.40\n01/09/2026,ACME LTD SALARY,"2,850.00"\n03/09/2026,PRET A MANGER,-4.20\n');
    expect(r.bank).toBe('hsbc');
    expect(pick(r.rows)).toEqual([['2026-09-02', -23.4, 'TESCO STORES 2041'], ['2026-09-01', 2850, 'ACME LTD SALARY'], ['2026-09-03', -4.2, 'PRET A MANGER']]);
  });

  it('Barclays: cleans the memo but keeps the reference', () => {
    const r = parseStatement('Number,Date,Account,Amount,Subcategory,Memo\n,02/09/2026,20-00-00 12345678,-23.40,PAYMENT,TESCO STORES 2041    ON 01 SEP          BCC\n,01/09/2026,20-00-00 12345678,2850.00,DIRECTDEP,ACME LTD           SALARY\n');
    expect(r.bank).toBe('barclays');
    expect(pick(r.rows)).toEqual([['2026-09-02', -23.4, 'TESCO STORES 2041'], ['2026-09-01', 2850, 'ACME LTD SALARY']]);
  });

  it('Revolut: completed only, fees included, currency kept', () => {
    const r = parseStatement('Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCARD_PAYMENT,Current,2026-09-02 10:01:02,2026-09-03 09:00:00,Tesco,-23.40,0.00,GBP,COMPLETED,100\nCARD_PAYMENT,Current,2026-09-02 10:01:02,,Amazon,-9.99,0.00,GBP,PENDING,100\nCARD_PAYMENT,Current,2026-09-04 10:01:02,2026-09-04 10:02:00,Zara Paris,-50.00,1.00,EUR,COMPLETED,40\nTRANSFER,Current,2026-09-04 10:01:02,2026-09-04 10:02:00,Refund,-5,0,GBP,REVERTED,40\n');
    expect(r.bank).toBe('revolut');
    expect(r.skipped).toBe(2);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { date: '2026-09-03', amount: -23.4, description: 'Tesco', currency: 'GBP', account: 'Revolut Current', bank: 'revolut' },
      { date: '2026-09-04', amount: -51, description: 'Zara Paris', currency: 'EUR', account: 'Revolut Current', bank: 'revolut' },
    ]);
  });

  it('Monzo export is recognised', () => {
    const r = parseStatement('Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In\ntx_1,02/09/2026,10:00:00,Card payment,Tesco,🛒,Groceries,-23.40,GBP,-23.40,GBP,,,,TESCO STORES,,-23.40,\n');
    expect(r.bank).toBe('monzo');
    expect(pick(r.rows)).toEqual([['2026-09-02', -23.4, 'Tesco']]);
  });

  it('an unknown layout still imports generically', () => {
    const r = parseStatement('Date,Details,Amount\n2026-09-02,Coffee,-3.10\n');
    expect(r.bank).toBe(null);
    expect(r.rows).toEqual([{ date: '2026-09-02', amount: -3.1, description: 'Coffee' }]);
  });
});
