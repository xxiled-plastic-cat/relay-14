import { PageFrame } from "../components/PageFrame";

export function NotFoundPage() {
  return (
    <PageFrame title="Not found">
      <p className="page-status">
        That page is not on this relay. <a href="/">Return home.</a>
      </p>
    </PageFrame>
  );
}
