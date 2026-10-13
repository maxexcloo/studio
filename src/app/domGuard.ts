/**
 * Page translators and some extensions swap React's text nodes for their own (Chrome wraps them in <font>),
 * and not all of them honour translate="no". React then removes or inserts next to a node that's no longer
 * where it left it, and the DOM throws. Skipping those calls costs a stale bit of translated text until the
 * next render instead of the whole studio (facebook/react#11538).
 */
if (typeof Node === 'function' && Node.prototype) {
  const removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      console.warn('Skipped removing a node that something outside the studio already moved', child, this);
      return child;
    }
    return removeChild.call(this, child) as T;
  };
  const insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, reference: Node | null): T {
    if (reference && reference.parentNode !== this) {
      console.warn('Inserted at the end: the reference node was moved by something outside the studio', reference, this);
      return this.appendChild(node);
    }
    return insertBefore.call(this, node, reference) as T;
  };
}

export {};
