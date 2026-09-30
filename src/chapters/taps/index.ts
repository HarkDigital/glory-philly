import { BRAND, SECTIONS } from '../../content'
import { BEERS } from '../../kit/beer'
import { placeholder } from '../placeholder'

// PLACEHOLDER — replaced by this chapter's build.
void BRAND
void SECTIONS
export default () => placeholder('taps', SECTIONS.taps.eyebrow, SECTIONS.taps.title, BEERS.amber, [0.25, 0.5, 0.75])
