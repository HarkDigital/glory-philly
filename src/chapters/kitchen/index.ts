import { BRAND, SECTIONS } from '../../content'
import { BEERS } from '../../kit/beer'
import { placeholder } from '../placeholder'

// PLACEHOLDER — replaced by this chapter's build.
void BRAND
void SECTIONS
export default () => placeholder('kitchen', SECTIONS.kitchen.eyebrow, SECTIONS.kitchen.title, BEERS.straw, [0.18, 0.36, 0.54, 0.72, 0.88])
