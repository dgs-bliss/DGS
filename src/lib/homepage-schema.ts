import homepageSchema from '../content/dgs-homepage-schema.json';
export { homepageSchema };

const faqDefinitions = [
	['text-when-and-where-do-you-meet', 'text-every-friday-at-8-30-a-m-pacific-11-30-a-m-easte'],
	['text-what-does-a-guest-session-look-like', 'text-we-start-with-a-quick-round-of-introductions-abo'],
	['text-do-i-need-a-polished-presentation', 'text-no-this-isn-t-a-conference-stage-and-it-s-pretty'],
	['text-can-i-share-something-i-m-building', 'text-yes-guests-often-beta-launch-or-beta-test-their-'],
	['text-does-it-cost-anything-to-present', 'text-no-presenting-is-free'],
	['text-what-happens-after-i-apply', 'text-we-read-every-application-and-you-ll-hear-back-f'],
	['text-will-my-session-be-shared', 'text-no-sessions-are-recorded-for-members-only-everyt'],
	['text-how-do-i-join-the-dozen', 'text-you-don-t-apply-to-join-guests-present-first-and'],
] as const;
const faqNode = homepageSchema['@graph'].find((node) => node['@type'] === 'FAQPage')!;
export function resolveHomepageFaq(faqTexts: { key?: string | null; value?: string | null }[] = []) {
  const textValue = (key: string, fallback: string) => faqTexts.find((item) => item?.key === key)?.value || fallback;
  return faqDefinitions.map(([questionKey, answerKey], i) => ({
	question: textValue(questionKey, faqNode.mainEntity![i].name),
	answer: textValue(answerKey, faqNode.mainEntity![i].acceptedAnswer.text),
  }));
}
export const glossary = homepageSchema['@graph'].find((node) => node['@type'] === 'DefinedTermSet')!;
export const terms = homepageSchema['@graph'].filter((node) => node['@type'] === 'DefinedTerm');
