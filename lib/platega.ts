const PLATEGA_BASE_URL = process.env.PLATEGA_API_BASE_URL || 'https://app.platega.io';

function getHeaders(): Record<string, string> {
  const merchantId = process.env.PLATEGA_MERCHANT_ID;
  const secret = process.env.PLATEGA_SECRET;

  if (!merchantId || !secret) {
    throw new Error('PLATEGA_MERCHANT_ID and PLATEGA_SECRET must be set');
  }

  return {
    'Content-Type': 'application/json',
    'X-MerchantId': merchantId,
    'X-Secret': secret,
  };
}

export type CreateTransactionInput = {
  amount: number;
  currency?: string;
  description: string;
  returnUrl?: string;
  failedUrl?: string;
  payload?: string;
};

export type CreateTransactionResponse = {
  paymentMethod: string;
  transactionId: string;
  redirect: string;
  return?: string;
  paymentDetails: string | { amount: number; currency: string };
  status: string;
  expiresIn: string;
  merchantId: string;
  usdtRate?: number;
};

export type TransactionStatusResponse = {
  id: string;
  status: 'PENDING' | 'CANCELED' | 'CONFIRMED' | 'CHARGEBACKED';
  paymentDetails: { amount: number; currency: string };
  merchantName?: string;
  mechantId?: string;
  comission?: number;
  paymentMethod?: string;
  expiresIn?: string;
  return?: string;
  qr?: string;
  payload?: string;
  description?: string;
};

export async function createSbpTransaction(
  input: CreateTransactionInput
): Promise<CreateTransactionResponse> {
  const response = await fetch(`${PLATEGA_BASE_URL}/transaction/process`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      paymentMethod: 2,
      paymentDetails: {
        amount: input.amount,
        currency: input.currency || 'RUB',
      },
      description: input.description,
      return: input.returnUrl,
      failedUrl: input.failedUrl,
      payload: input.payload,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Platega API error ${response.status}: ${text}`);
  }

  return response.json();
}

export async function getTransactionStatus(
  transactionId: string
): Promise<TransactionStatusResponse> {
  const response = await fetch(
    `${PLATEGA_BASE_URL}/transaction/${transactionId}`,
    {
      method: 'GET',
      headers: getHeaders(),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Platega API error ${response.status}: ${text}`);
  }

  return response.json();
}

export function verifyCallbackHeaders(
  merchantId: string,
  secret: string
): boolean {
  return (
    merchantId === process.env.PLATEGA_MERCHANT_ID &&
    secret === process.env.PLATEGA_SECRET
  );
}
