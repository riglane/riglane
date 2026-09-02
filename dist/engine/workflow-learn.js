import { instruction } from './instruction-files.js';
const TOPICS = {
    overview: () => instruction('learn/overview'),
    'step-fields': () => instruction('learn/step-fields'),
    goals: () => instruction('learn/goals'),
    inputs: () => instruction('learn/inputs'),
    outputs: () => instruction('learn/outputs'),
    parallel: () => instruction('learn/parallel'),
    delegation: () => instruction('learn/delegation'),
    gate: () => instruction('learn/gate'),
    planning: () => instruction('learn/planning'),
    'param-bindings': () => instruction('learn/param-bindings'),
    'carry-forward': () => instruction('learn/carry-forward'),
    'spec-check': () => instruction('learn/spec-check'),
    scopes: () => instruction('learn/scopes'),
    tools: () => instruction('learn/tools'),
    examples: () => instruction('learn/examples'),
    'spec-format': () => instruction('learn/spec-format'),
    'spec-tools': () => instruction('learn/spec-tools'),
    'struct-format': () => instruction('learn/struct-format'),
    'mcp-tools': () => instruction('learn/mcp-tools'),
    'predefined-workflows': () => instruction('learn/predefined-workflows'),
    'workflow-fields': () => instruction('learn/workflow-fields'),
    'design-choices': () => instruction('learn/design-choices'),
    'loop-back': () => instruction('learn/loop-back'),
    routes: () => instruction('learn/routes'),
    lanes: () => instruction('learn/lanes'),
    inbox: () => instruction('learn/inbox'),
};
export const AVAILABLE_TOPICS = Object.keys(TOPICS);
export function toolWorkflowLearn(args) {
    const topic = args.topic?.trim()?.toLowerCase() ?? 'overview';
    const generator = TOPICS[topic];
    if (!generator) {
        return {
            error: `Unknown topic '${topic}'.`,
            available_topics: Object.keys(TOPICS),
        };
    }
    return {
        content: generator(),
        available_topics: Object.keys(TOPICS),
    };
}
