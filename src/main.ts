import { mountWorkspace } from './agency/workspace';

const root = document.getElementById('app');
if (!root) throw new Error('Agency workspace mount is missing');
mountWorkspace(root);
