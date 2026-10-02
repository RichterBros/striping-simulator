export type EquipmentId =
  | 'striping-rig'
  | 'paint-white'
  | 'paint-yellow'
  | 'traffic-cones'
  | 'measuring-wheel'
  | 'stencil-kit';

export type EquipmentCategory = 'vehicle' | 'consumable' | 'tool';

export interface EquipmentDef {
  id: EquipmentId;
  name: string;
  category: EquipmentCategory;
  description: string;
  required: boolean;
}
