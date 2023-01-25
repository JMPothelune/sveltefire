import { writable, type Updater } from 'svelte/store';
import { doc, collection, onSnapshot, setDoc, deleteDoc, type WithFieldValue, type DocumentData, addDoc } from 'firebase/firestore';
import type {
  Firestore,
  Query,
  CollectionReference,
  DocumentReference,
} from 'firebase/firestore';
import { onAuthStateChanged, type Auth } from 'firebase/auth';
import { deepEqual, deepCopy } from '@firebase/util';
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
  let internalDocs: WithDocIdAndRef<T>[] = [];


  const { subscribe, update, set } = writable(startWith, (set) => {
    unsubscribe = onSnapshot(colRef, (snapshot) => {
      internalDocs = snapshot.docs.map((s) => {
        return { id: s.id, ref: s.ref, ...s.data() } as WithDocIdAndRef<T>;
      });
      set(deepCopy(internalDocs));
    });

    return () => unsubscribe();
  });

  const updateCollection = ( updater: Updater<WithDocIdAndRef<T>[]> ) => {
    update( () => {
      const newCollection = updater(internalDocs) || [];

      const updatedDocuments = newCollection.filter( (newDoc) => {
        const oldDoc = internalDocs.find( (doc) => {
          return newDoc.id === doc.id;
        });

        if(!oldDoc){
          return true;
        }
        const { oldRef, ...oldData } = oldDoc;
        const { newRef, ...newData } = newDoc;

        return !deepEqual(oldData, newData);
      });

      for (const document of updatedDocuments || []) {
        const { ref, ...data } = document;
        if(ref){
          setDoc(ref, data);
        }
      }

      return newCollection;
    });
  };

  const setCollection = ( value: WithDocIdAndRef<T>[] ) => {
    updateCollection( () => value );
  };

  const addDocument = (value: WithDocIdAndRef<T>, id?:string) => {
    if(colRef.type !== 'collection'){
      throw new Error('Cannot add document to a query');
    }

    const docId = id || value.id;

    if(docId){
      setDoc(doc(colRef as CollectionReference, docId), value);
    }
    
    if(!docId){
      addDoc(colRef as CollectionReference, value)
    }
  };

  const removeDocument = (document:WithDocIdAndRef<T>) => {
    let ref = document.ref;

    if(!ref && colRef.type === 'collection'){
      ref = doc(colRef as CollectionReference, document.id);
    }

    if(!ref){
      throw new Error('Cannot delete document without ref nor id');
    }

    deleteDoc(ref);
  };


  return {
    subscribe,
    update: updateCollection,
    set: setCollection,
    ref: colRef,
    add: addDocument,
    delete: removeDocument,
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
