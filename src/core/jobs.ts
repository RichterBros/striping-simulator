import type { EquipmentId } from './equipment.ts';
import type { StallLayoutSpec } from './layout.ts';

export interface JobDef {
  id: string;
  name: string;
  siteDescription: string;
  lot: StallLayoutSpec;
  requiredEquipment: EquipmentId[];
}
