'use client';

import { renderToggleAboveNodes, TogglePlugin } from '@platejs/toggle/react';
import { type AnyPluginConfig, KEYS } from 'platejs';
import type { RenderNodeWrapper } from 'platejs/react';

import { IndentKit } from '@/components/editor/plugins/indent-kit';
import { ToggleElement } from '@/components/ui/toggle-node';

const renderToggleVisibility = renderToggleAboveNodes as RenderNodeWrapper<AnyPluginConfig>;

export const ToggleKit = [
  ...IndentKit,
  TogglePlugin.withComponent(ToggleElement)
    .configure({
      render: {
        aboveNodes: (props) => {
          const { element } = props;
          const indent = Number(element[KEYS.indent] || 0);
          // Match Plate's list correction. A level-zero block cannot be
          // enclosed by a toggle, so it needs no visibility subscription.
          const correctedIndent = element.listStyleType && indent ? indent - 1 : indent;
          if (correctedIndent <= 0) return;
          const Visibility = renderToggleVisibility(props);
          if (!Visibility) return;
          // Plate calls wrappers directly; keep visibility hooks in their own
          // component when indentation changes attach or remove this wrapper.
          return (wrapperProps) => <Visibility {...wrapperProps} />;
        },
      },
    })
    .overrideEditor(({ editor, tf: { normalizeNode } }) => ({
      transforms: {
        normalizeNode(entry, options) {
          const [node, path] = entry;
          // Indentation levels are nonnegative; outdent uses the same unset
          // representation for level zero.
          if (typeof node.indent === 'number' && node.indent < 0) {
            editor.tf.unsetNodes('indent', { at: path });
            return;
          }
          normalizeNode(entry, options);
        },
      },
    })),
];
