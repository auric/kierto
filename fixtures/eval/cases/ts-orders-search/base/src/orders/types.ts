export const ORDER_STATUSES = ["open", "paid", "shipped", "cancelled", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Order = {
  id: number;
  customerName: string;
  status: OrderStatus;
  totalCents: number;
  createdAt: string;
};
