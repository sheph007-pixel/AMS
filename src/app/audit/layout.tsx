import { AdminGuard } from "../admin-guard";

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
