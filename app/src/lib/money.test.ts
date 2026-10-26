import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { amountInWords, formatInr, parseRupees } from './money.ts';
import { iosUpiAppLinks } from './upi-links.ts';

describe('parseRupees', () => {
  it('reads what people type', () => {
    assert.equal(parseRupees('300000'), 30_000_000);
    assert.equal(parseRupees('3,00,000'), 30_000_000);
    assert.equal(parseRupees('₹ 1500.5'), 150_050);
    assert.equal(parseRupees('1.15'), 115);
  });

  it('rejects anything that is not a positive amount', () => {
    for (const text of ['', '0', '0.00', 'abc', '1.234', '-5', '1e5', '1234567890123']) {
      assert.equal(parseRupees(text), null, text);
    }
  });
});

describe('formatInr', () => {
  it('groups digits the Indian way', () => {
    assert.equal(formatInr(30_000_000), '₹3,00,000.00');
  });
});

describe('amountInWords', () => {
  it('writes amounts as on a cheque', () => {
    assert.equal(amountInWords(30_000_000), 'Rupees three lakh only');
    assert.equal(amountInWords(35_050_000), 'Rupees three lakh fifty thousand five hundred only');
    assert.equal(amountInWords(1_234_567_800), 'Rupees one crore twenty-three lakh forty-five thousand six hundred seventy-eight only');
    assert.equal(amountInWords(150_050), 'Rupees one thousand five hundred and fifty paise only');
    assert.equal(amountInWords(100), 'Rupees one only');
    assert.equal(amountInWords(1_234_000_000_000), 'Rupees one thousand two hundred thirty-four crore only');
  });
});

describe('iosUpiAppLinks', () => {
  it('keeps the payment details for every app', () => {
    const links = iosUpiAppLinks('upi://pay?pa=epay%40axis&am=1.00&cu=INR');
    assert.deepEqual(
      links.map((link) => link.url),
      [
        'tez://upi/pay?pa=epay%40axis&am=1.00&cu=INR',
        'phonepe://pay?pa=epay%40axis&am=1.00&cu=INR',
        'paytmmp://pay?pa=epay%40axis&am=1.00&cu=INR',
        'upi://pay?pa=epay%40axis&am=1.00&cu=INR',
      ],
    );
  });
});
