import { BRAND, SECTIONS } from '../../content'
import { BEERS } from '../../kit/beer'
import { placeholder } from '../placeholder'

// PLACEHOLDER — replaced by this chapter's build.
void BRAND
void SECTIONS
export default () => placeholder('people', SECTIONS.people.eyebrow, SECTIONS.people.title, BEERS.stout, [0.3, 0.55, 0.8])
