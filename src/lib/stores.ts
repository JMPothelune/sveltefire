import { writable, type Updater } from 'svelte/store';
import { doc, collection, onSnapshot, setDoc, deleteDoc, type WithFieldValue, type DocumentData } from 'firebase/firestore';
import type {
  Firestore,
  Query,
  CollectionReference,
  DocumentReference,
} from 'firebase/firestore';
import { onAuthStateChanged, type Auth } from 'firebase/auth';
import { deepEqual } from '@firebase/util';
type WithDocIdAndRef<T> = T & { id?: string, ref?: DocumentReference };

/**
 * @param  {Firestore} firestore firebase firestore instance
 * @param  {string|DocumentReference} ref document path or reference
 * @param  {any} startWith optional default data
 * @returns a store with realtime updates on document data
 */
export function docStore<T extends WithFieldValue<DocumentData>>(
  firestore: Firestore,
  ref: string | DocumentReference,
  startWith?: T
) {
  let unsubscribe: () => void;

  // Fallback for SSR
  if (!firestore || !globalThis.window) {
    console.warn('Firestore is not initialized or not in browser');
    const { subscribe } = writable(startWith);
    return {
      subscribe,
      ref: null,
      id: '',
    }
  }

  const docRef = typeof ref === 'string' ? doc(firestore, ref) : ref;

  const { subscribe, update, set } = writable<T | null>(startWith, (set) => {
    unsubscribe = onSnapshot(docRef, (snapshot) => {
      set((snapshot.data() as T) ?? null);
    });

    return () => unsubscribe();
  });

  const updateDocument = ( updater: Updater<T | null> ) => {
    update( (previousDoc: T | null ) => {
      const newDoc = updater(previousDoc);
      if(!newDoc){
        setDoc(docRef, {});
      }
      else{
        setDoc(docRef, newDoc);
      }
      return newDoc;
    });
  };


  const setDocument = ( value: T ) => {
    updateDocument( () => value );
  };


  return {
    subscribe,
    update: updateDocument,
    set: setDocument,
    ref: docRef,
    id: docRef.id,
  };
}



/**
 * @param  {Firestore} firestore firebase firestore instance
 * @param  {string|Query|CollectionReference} ref collection path, reference, or query
 * @param  {[]} startWith optional default data
 * @returns a store with realtime updates on collection data
 */
export function collectionStore<T extends WithFieldValue<DocumentData>>(
  firestore: Firestore,
  ref: string | Query | CollectionReference,
  startWith: (WithDocIdAndRef<T>)[] = []
) {
  let unsubscribe: () => void;

  // Fallback for SSR
  if (!firestore || !globalThis.window) {
    console.warn('Firestore is not initialized or not in browser');
    const { subscribe } = writable(startWith);
    return {
      subscribe,
      ref: null,
    }
  }

  const colRef = typeof ref === 'string' ? collection(firestore, ref) : ref;


  const { subscribe, update, set } = writable(startWith, (set) => {
    unsubscribe = onSnapshot(colRef, (snapshot) => {
      const data = snapshot.docs.map((s) => {
        return { id: s.id, ref: s.ref, ...s.data() } as WithDocIdAndRef<T>;
      });
      set(data);
    });

    return () => unsubscribe();
  });

  const updateCollection = ( updater: Updater<WithDocIdAndRef<T>[]> ) => {
    update( (previousCollection) => {
      const newCollection = updater(previousCollection) || [];

      const removedDocuments = previousCollection.filter( (doc) => {
        return !newCollection.find( (newDoc) => {
          return newDoc.id === doc.id;
        });
      });

      for (const doc of removedDocuments || []) {
        if(doc.ref){
          deleteDoc(doc.ref);
        }
      }


      const updatedDocuments = newCollection.filter( (newDoc) => {
        return previousCollection.find( (doc) => {
          return newDoc.id === doc.id && deepEqual(newDoc, doc);
        });
      });

      for (const doc of newCollection || []) {
        if(doc.ref){
          setDoc(doc.ref, doc);
        }
      }

      return newCollection;
    });
  };

  const setCollection = ( value: WithDocIdAndRef<T>[] ) => {
    updateCollection( () => value );
  };


  return {
    subscribe,
    update: updateCollection,
    set: setCollection,
    ref: colRef,
  };
}
/**
 * @param  {Auth} auth firebase auth instance
 * @returns a store with the current firebase user
 */
export function userStore(auth: Auth) {
  let unsubscribe: () => void;

  if (!auth || !globalThis.window) {
    console.warn('Auth is not initialized on not in browser');
    const { subscribe } = writable(null);
    return {
      subscribe,
    }
  }

  const { subscribe } = writable(auth?.currentUser ?? null, (set) => {
    unsubscribe = onAuthStateChanged(auth, (user) => {
      set(user);
    });

    return () => unsubscribe();
  });

  return {
    subscribe,
  };
}

// SDK store for FirebaseApp comopnent
export const sdk = writable<{ auth: Auth; firestore: Firestore }>();
