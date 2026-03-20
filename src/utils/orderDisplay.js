export const getOrderDisplayId = (orderLike) => {
  if (!orderLike) return "UNKNOWN";

  const orderNumber =
    typeof orderLike.orderNumber === "string"
      ? orderLike.orderNumber.trim()
      : "";
  if (orderNumber) return orderNumber;

  const rawId =
    orderLike._id?.toString?.() ||
    orderLike.orderId?.toString?.() ||
    (typeof orderLike === "string" ? orderLike : "");

  if (!rawId) return "UNKNOWN";
  return rawId.slice(-8).toUpperCase();
};
