/** E-mails (separados por vírgula em PLATFORM_ADMIN_EMAILS) que administram a plataforma. */
export function platformAdminEmails(env: string | undefined = process.env.PLATFORM_ADMIN_EMAILS): string[] {
  return (env ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isPlatformAdminEmail(email: string | null | undefined, env?: string): boolean {
  if (!email) return false;
  return platformAdminEmails(env ?? process.env.PLATFORM_ADMIN_EMAILS).includes(email.trim().toLowerCase());
}
