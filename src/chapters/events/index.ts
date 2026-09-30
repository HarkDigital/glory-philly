import { BRAND, SECTIONS } from '../../content'
import { BEERS } from '../../kit/beer'
import { placeholder } from '../placeholder'

// PLACEHOLDER — replaced by this chapter's build.
void BRAND
void SECTIONS
export default () => placeholder('events', SECTIONS.events.eyebrow, SECTIONS.events.title, BEERS.rose, [0.4, 0.8])
