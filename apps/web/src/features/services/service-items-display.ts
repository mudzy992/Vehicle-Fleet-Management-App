/** Lokalizovani prikaz računa; ne mijenja iznose koji se šalju serveru. */
const moneyFormat = new Intl.NumberFormat('bs-BA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantityFormat = new Intl.NumberFormat('bs-BA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export function formatServiceMoney(feninzi: number): string {
  return `${moneyFormat.format(feninzi / 100)} KM`;
}
export function formatServiceQuantity(hundredths: number): string {
  return quantityFormat.format(hundredths / 100);
}
