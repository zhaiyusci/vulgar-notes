import { BaseEquationPlugin, BaseInlineEquationPlugin } from '@/plate-math-plugins';

import {
  EquationElementStatic,
  InlineEquationElementStatic,
} from '@/components/ui/equation-node-static';

export const BaseMathKit = [
  BaseInlineEquationPlugin.withComponent(InlineEquationElementStatic),
  BaseEquationPlugin.withComponent(EquationElementStatic),
];
