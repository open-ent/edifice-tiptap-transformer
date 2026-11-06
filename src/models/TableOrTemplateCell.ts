import { TableCell } from '@open-ent/tiptap-extensions/table-cell';
import { mergeAttributes } from '@tiptap/core';

export default TableCell
  /* transformer-only : WB-2568, preserve text-align attributes found on <td> in old-format documents.
   *
   * This extension moves the `style="text-align:XXX;"` attribute from the <td> to a nested <p> inside the <td>.
   * Known issue : when an <td> has no child except a text-node, the text-node will be wrapped in another <p>
   * and the final result will be `<td><p style="text-align:XXX;"><p>text node</p></p></td>`
   */
  .extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        'data-text-align': { default: null },
      };
    },
    parseHTML() {
      try {
        return [
          {
            tag: 'td[style]:not(:where(> p))',
            getAttrs: (node: HTMLElement) => {
              const textAlign = node.style.textAlign;
              if (
                ['left', 'right', 'center', 'justify'].findIndex(
                  (value) => value === textAlign,
                ) >= 0
              ) {
                return mergeAttributes(this.options.HTMLAttributes, {
                  'data-text-align': textAlign,
                });
              }
              return false;
            },
            //consuming: false,
            //skip: true,
          },
          //@ts-ignore see catch below, which is never used anyway.
          ...this.parent(),
        ];
      } catch {
        return this.parent?.();
      }
    },

    renderHTML(params) {
      const { HTMLAttributes } = params;
      const textAlign = HTMLAttributes?.['data-text-align'];
      if (textAlign) {
        const paragraphAttrs = { style: `text-align: ${textAlign};` };
        const cellAttrs = mergeAttributes(
          this.options.HTMLAttributes,
          HTMLAttributes,
          { 'data-text-align': undefined },
        );
        return ['td', cellAttrs, ['p', paragraphAttrs, 0]];
      }
      // This line keeps the transpiler happy
      if (!this.parent) {
        return [
          'td',
          mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
          0,
        ];
      }
      return this.parent({
        ...params,
        HTMLAttributes: { ...HTMLAttributes, 'data-text-align': undefined },
      });
    },
  })
  /*
   * transformer-only : parse old-format "cell column" as cells
   */
  .extend({
    parseHTML() {
      return this.parent?.()?.concat([{ tag: '.cell.column' }]);
    },
  });
