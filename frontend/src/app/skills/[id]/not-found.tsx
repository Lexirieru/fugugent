import { ButtonLink, EmptyState, Page, Section } from "@/components/ui";

/**
 * The 404 for a skill, and it means what it says.
 *
 * The backend answers 404 only when every level of its ladder answered and none of them
 * threw, a registry that is merely sick produces a 200 with `healthy: false`, which the
 * skill page renders as "we cannot tell you", not as this. Those two states must never
 * be the same page.
 */
export default function SkillNotFound() {
  return (
    <Page>
      <Section>
        <EmptyState
          title="No skill with that id"
          body="The registry answered, and it holds nothing under that id. This is a real answer rather than a failed lookup: if we could not reach the registry you would be told that instead."
          actions={
            <>
              <ButtonLink href="/skills">Browse every skill</ButtonLink>
              <ButtonLink href="/skills?status=PASSED" variant="ghost">
                Show the ones that passed
              </ButtonLink>
            </>
          }
        />
      </Section>
    </Page>
  );
}
