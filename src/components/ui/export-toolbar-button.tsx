'use client';

import * as React from 'react';
import type { DropdownMenuProps } from '@radix-ui/react-dropdown-menu';
import { MarkdownPlugin } from '@platejs/markdown';
import { ArrowDownToLineIcon } from 'lucide-react';
import { useEditorRef } from 'platejs/react';
import { toast } from 'sonner';
import { saveExport } from '@/platform';
import { latexDocument } from '@/latex-document';
import { t } from '@/i18n';
import { HostContext } from '@/plate-math-element';
import { useBibliographyLibraries,useBibliographyStyle } from '@/use-bibliography';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToolbarButton } from './toolbar';

type ExportFormat = 'markdown' | 'latex';

export function ExportToolbarButton(props: DropdownMenuProps) {
  const editor = useEditorRef();
  const host = React.useContext(HostContext),libraries=useBibliographyLibraries(),style=useBibliographyStyle();
  const [open, setOpen] = React.useState(false);

  const exportDocument = async (format: ExportFormat) => {
    try {
      const content = format === 'markdown'
          ? host?.exportMarkdown()??editor.getApi(MarkdownPlugin).markdown.serialize()
          : latexDocument(editor.children,libraries,style);
      const extension = {markdown: 'md', latex: 'tex'}[format];
      const mime = {markdown: 'text/markdown', latex: 'application/x-tex'}[format];
      await saveExport(new Blob([content], {type: `${mime};charset=utf-8`}), `document.${extension}`);
    } catch (error) {
      toast.error(t('Export failed'), {description: String(error)});
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton pressed={open} tooltip="Export" isDropdown>
          <ArrowDownToLineIcon className="size-4" />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void exportDocument('markdown')}>Markdown (.md)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportDocument('latex')}>LaTeX (.tex)</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
