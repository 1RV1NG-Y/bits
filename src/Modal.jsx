import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, children, onClose, className = '', actions }) {
  const ref = useRef();
  const backdropPress = useRef(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    node.showModal();
    node.querySelector("textarea")?.focus();
    const cancel = e => { e.preventDefault(); closeRef.current(); };
    node.addEventListener('cancel', cancel);
    return () => { node.removeEventListener('cancel', cancel); node.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); backdropPress.current = e.target === e.currentTarget && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom); }} onClick={e => { if (backdropPress.current && e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }} aria-labelledby="modal-title">
    <header className="modal-header"><h2 id="modal-title">{title}</h2><div className="modal-actions">{actions}<button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div></header>{children}
  </dialog>;
}
