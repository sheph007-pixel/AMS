import { AdminGuard } from "../admin-guard";

export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
