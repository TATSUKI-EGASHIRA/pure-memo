import React from 'react';
import {ChevronDownIcon,InfoCircledIcon} from '@radix-ui/react-icons';

export function PageHeading({Icon,title,meta,actions,className=''}){
  return <header className={`page-heading ${className}`}>
    <div className="page-heading-title"><Icon aria-hidden="true"/><h1>{title}</h1>{meta!=null&&<span className="page-heading-meta">{meta}</span>}</div>
    {actions&&<div className="page-heading-actions">{actions}</div>}
  </header>;
}

export function InfoDetails({label='詳細',Icon=InfoCircledIcon,children,className=''}){
  return <details className={`ui-details ${className}`}>
    <summary><Icon aria-hidden="true"/><span>{label}</span><ChevronDownIcon className="details-chevron" aria-hidden="true"/></summary>
    <div className="ui-details-content">{children}</div>
  </details>;
}
