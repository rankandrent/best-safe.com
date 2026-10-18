/**
 * Layout blocks: wrap each H2 and the content that follows it (until the next
 * H2) in a <section>, so every topic is a clearly bounded block in the HTML.
 */
export function rehypeSections() {
  return (tree) => {
    const out = [];
    let current = null;
    for (const node of tree.children) {
      if (node.type === 'element' && node.tagName === 'h2') {
        current = { type: 'element', tagName: 'section', properties: { className: ['block'] }, children: [node] };
        out.push(current);
      } else if (current) {
        current.children.push(node);
      } else {
        out.push(node);
      }
    }
    tree.children = out;
  };
}
