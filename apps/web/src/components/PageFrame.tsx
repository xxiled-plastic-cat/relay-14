import type { ReactNode } from "react";

export function PageFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="stage stage-page">
      <header className="page-head">
        <a className="home-mark" href="/">
          RELAY-14
        </a>
        <p className="page-title">{title}</p>
      </header>
      {children}
    </main>
  );
}
