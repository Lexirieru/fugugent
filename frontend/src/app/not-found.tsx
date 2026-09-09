import { ButtonLink, EmptyState, Page, Section } from "@/components/ui";

export default function NotFound() {
  return (
    <Page>
      <Section>
        <EmptyState
          title="No agent with that id"
          body="Agent pages are addressed by a stable key made of the network number and the agent number, like 97:1. Nothing is registered under the one you opened."
          actions={
            <>
              <ButtonLink href="/agents">Browse all agents</ButtonLink>
              <ButtonLink href="/agent/97%3A1" variant="ghost">
                Open Fugu Guardian
              </ButtonLink>
            </>
          }
        />
      </Section>
    </Page>
  );
}
