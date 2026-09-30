import { BRAND, SECTIONS } from '../../content'
import { BEERS } from '../../kit/beer'
import { placeholder } from '../placeholder'

// PLACEHOLDER — replaced by this chapter's build.
void BRAND
void SECTIONS
export default () => placeholder('cellar', SECTIONS.cellar.eyebrow, SECTIONS.cellar.title, BEERS.ruby, [0.2, 0.35, 0.5, 0.65, 0.82])
