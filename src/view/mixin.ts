import type { HandwritingView } from '../../main';

/** Helper for view mixins: `this` in the methods is typed as HandwritingView. */
export function defineMixin<T extends object>(methods: T & ThisType<HandwritingView>): T {
    return methods;
}
