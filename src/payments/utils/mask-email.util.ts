/**
 * Masks an email for merchant-facing API responses: "customer@example.com" -> "c***@example.com".
 */
export function maskEmail(email: string | null | undefined): string | null | undefined {
  if (!email) return email;
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.charAt(0)}***${email.slice(at)}`;
}
