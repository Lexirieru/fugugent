import { ButtonLink, EmptyState, Section } from "@/components/ui";

export default function NotFound() {
  return (
    <Section className="pt-16">
      <EmptyState
        title="No agent with that id"
        body="Agent pages are addressed by their stable key — chain id and token id, like 97:1. Nothing is registered under the one you opened."
        actions={
          <>
            <ButtonLink href="/">Browse all agents</ButtonLink>
            <ButtonLink href="/agent/97%3A1" variant="ghost">
              Open Fugu Guardian
            </ButtonLink>
          </>
        }
      />
    </Section>
  );
}
