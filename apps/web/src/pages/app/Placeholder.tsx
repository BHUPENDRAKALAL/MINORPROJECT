import type { NavItem } from "../../app/nav";
import { PageHeader } from "../../components/kit";
import { useTitle } from "../../lib/useTitle";

/** A page that has its route and place in the nav, but whose feature is not built yet. Says what will appear. */
export default function Placeholder({ item }: { item: NavItem }) {
  const title = item.title ?? item.label;
  useTitle(title);
  return (
    <>
      <PageHeader title={title} eyebrow={<span className="ui-tag">Coming soon</span>} />
      <div className="rq-empty-state ph-empty">
        <p className="rq-empty-title">Not built yet</p>
        <p>{item.empty ?? "This page is on its way."}</p>
      </div>
    </>
  );
}
