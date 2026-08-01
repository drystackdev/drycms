import{useState as e}from"./preact.js";import{jsx as t,jsxs as n}from"./preact.js";function r(e,t,n,i){return{kind:e,req:t,defaultValue:n,inner:i?.inner,shape:i?.shape,minCount:i?.minCount,maxCount:i?.maxCount,minLength:i?.minLength,maxLength:i?.maxLength,description:i?.description,required:()=>r(e,!0,n,i),default:n=>r(e,t,n,i)}}function i(e){return r(`string`,!1,void 0,{minLength:e?.minLength,maxLength:e?.maxLength,description:e?.description})}function a(e){return r(`int`,!1,void 0,{description:e?.description})}function o(e){return r(`image`,!1,void 0,{description:e?.description})}function s(e){return r(`boolean`,!1,!1,{description:e?.description})}function c(e,t){return r(`array`,!1,void 0,{inner:e,minCount:t?.min,maxCount:t?.max,description:t?.description})}function l(e){return c(o(),e)}function u(e,t){return r(`object`,!1,void 0,{shape:e,description:t?.description})}var d=(e=>e);d.string=i,d.int=a,d.image=o,d.images=l,d.boolean=s,d.array=c,d.object=u;function f(e){switch(e.kind){case`string`:case`image`:return``;case`int`:return 0;case`boolean`:return!1;case`array`:return[];case`object`:return p(e.shape)}}function p(e){let t={};for(let n of Object.keys(e)){let r=e[n];t[n]=r.defaultValue===void 0?f(r):r.defaultValue}return t}function m(e){let t=h(e.component.name),n=e.props?.(d)??{},r=e.type??`inline`,i=e.shadow??!0,a=e.style;a!==void 0&&!i&&(console.warn(`[drycms] Richtext component "${t||`(unnamed)`}": "style" requires "shadow: true" - ignoring.`),a=void 0);let o=e.children!==void 0&&e.children!==!1,s=typeof e.children==`string`?e.children:void 0,c=e.refs??[];c.length>0&&!o&&(console.warn(`[drycms] Richtext component "${t||`(unnamed)`}": "refs" requires "children" - ignoring.`),c=[]),o&&(!i||r!==`block`)&&(console.warn(`[drycms] Richtext component "${t||`(unnamed)`}": "children" requires "shadow: true" and "type: \\"block\\"" - ignoring.`),o=!1,s=void 0),o||(c=[]);let l={__dryComponent:!0,name:t,label:e.label,description:e.description??``,version:e.version??`0.0.0`,auth:e.auth??``,type:r,shadow:i,style:a,children:o,childrenDefaultHtml:s,refs:c,schema:n,defaults:p(n),component:e.component};return l.update=e=>{e.label!==void 0&&(l.label=e.label),e.description!==void 0&&(l.description=e.description),e.version!==void 0&&(l.version=e.version),e.auth!==void 0&&(l.auth=e.auth),e.component!==void 0&&(l.component=e.component),e.props!==void 0&&(l.schema=e.props(d),l.defaults=p(l.schema));let t=e.type??l.type,n=e.shadow??l.shadow,r=e.children===void 0?l.children:e.children!==!1,i=typeof e.children==`string`?e.children:l.childrenDefaultHtml,a=e.style===void 0?l.style:e.style,o=e.refs===void 0?l.refs:e.refs;return a!==void 0&&!n&&(a=void 0),r&&(!n||t!==`block`)&&(r=!1,i=void 0),r||(o=[],i=void 0),l.type=t,l.shadow=n,l.style=a,l.children=r,l.childrenDefaultHtml=i,l.refs=o,l},l}function h(e){return e.replace(/([a-z0-9])([A-Z])/g,`$1-$2`).replace(/[^a-zA-Z0-9]+/g,`-`).replace(/^-+|-+$/g,``).toLowerCase()}var g=`.carousel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.carousel__content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  position: relative;
}

.carousel__content img {
  width: 100%;
  aspect-ratio: 16 / 9;
}

.carousel__content button {
  position: absolute;
  z-index: 2;
  background-color: red;
}

.carousel__caption {
  margin: 0;
  text-align: center;
}
`,_=[`https://picsum.photos/seed/site-carousel-1/480/280`,`https://picsum.photos/seed/site-carousel-2/480/280`,`https://picsum.photos/seed/site-carousel-3/480/280`],v=e=>e({images:e.images().default(_),caption:e.string()});function y({images:r,caption:i}){let[a,o]=e(0),s=r&&r.length>0?r:_,c=Math.min(a,s.length-1);return n(`div`,{className:`carousel`,children:[n(`div`,{className:`carousel__content`,children:[t(`button`,{type:`button`,onClick:()=>o(e=>(e-1+s.length)%s.length),children:`‹`}),t(`img`,{src:s[c],alt:i||`Slide ${c+1}`}),t(`button`,{type:`button`,style:{right:1},onClick:()=>o(e=>(e+1)%s.length),children:`›`})]}),i?t(`p`,{className:`carousel__caption`,children:i}):null]})}var b=m({label:`Carousel`,description:`An inline image carousel with prev/next controls and an optional caption.`,type:`inline`,props:v,style:g,component:y}),x=e=>e({color:e.string().default(`#e11d48`)});function S({color:e}){return t(`div`,{className:`color-text`,style:{color:e||`#e11d48`},children:t(`slot`,{})})}var C=m({label:`Colored text`,description:`Wraps nested rich text and changes its color - drop any paragraph/heading/list inside.`,type:`block`,style:`
    .color-text {
      border-left: 3px solid currentColor;
      padding-inline-start: 0.75rem;
    }
  `,children:`
    <h3>Wraps nested rich text and changes its color</h3>
    <p>Wraps nested rich text and changes its color - drop any paragraph/heading/list inside.</p>
    <p>Wraps nested rich text and changes its color - drop any paragraph/heading/list inside.</p>
    <p>Wraps nested rich text and changes its color - drop any paragraph/heading/list inside.</p>
  `,props:x,component:S,refs:[b]});export{C as default};