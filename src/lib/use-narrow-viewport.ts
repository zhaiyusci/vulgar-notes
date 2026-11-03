import {useSyncExternalStore} from 'react';

// Match Tailwind's sm breakpoint, including a changed browser default font size.
const desktopBreakpoint='(min-width: 40rem)';
type ViewportStore={subscribe:(listener:()=>void)=>()=>void;getSnapshot:()=>boolean};
const stores=new WeakMap<Window,ViewportStore>();
const serverSnapshot=()=>false;
const serverStore:ViewportStore={subscribe:()=>()=>{},getSnapshot:serverSnapshot};

/** One native media listener, shared by every block gutter in this window. */
function viewportStore():ViewportStore {
  if(typeof window==='undefined'||typeof window.matchMedia!=='function')return serverStore;
  const existing=stores.get(window);if(existing)return existing;
  const query=window.matchMedia(desktopBreakpoint),listeners=new Set<()=>void>();
  const notify=()=>{for(const listener of listeners)listener();};
  const store:ViewportStore={
    getSnapshot:()=>!query.matches,
    subscribe:listener=>{
      listeners.add(listener);
      if(listeners.size===1)query.addEventListener('change',notify);
      return ()=>{listeners.delete(listener);if(!listeners.size)query.removeEventListener('change',notify);};
    },
  };
  stores.set(window,store);return store;
}

export function useNarrowViewport():boolean {
  const store=viewportStore();
  return useSyncExternalStore(store.subscribe,store.getSnapshot,serverSnapshot);
}
