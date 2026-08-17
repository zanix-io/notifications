// deno-coverage-ignore-file

import { Provider, registerCoreProviderSlot, ZanixWorkerProvider } from '@zanix/server'
import { WorkerManager } from '@zanix/workers'

registerCoreProviderSlot('worker', ZanixWorkerProvider, {
  sourcePackage: '@zanix/server',
})

@Provider('worker')
class _ZWP extends ZanixWorkerProvider {
  constructor() {
    super(undefined, 0)
  }
  public override runJob(): Promise<boolean> | boolean {
    return true
  }
  public override runTask(): boolean {
    return true
  }
  // deno-lint-ignore no-explicit-any
  public override executeGeneralTask(fn: any, options: any) {
    const { metaUrl, callback, timeout } = options
    const tasker = new WorkerManager().task(fn, {
      metaUrl,
      onFinish: callback,
      timeout,
    })
    return tasker.invoke.bind(tasker)
  }
}
