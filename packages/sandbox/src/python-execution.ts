/** Notebook-style expression capture shared by local and remote Python runtimes. */
export function pythonExecutionSource(encodedExpression: string, indentation = ''): string {
  return `import ast as _larkup_ast, base64 as _larkup_base64
def _larkup_display_expression(value, final=False):
    if value is not None:
        table = globals().get('larkup_table')
        if final and callable(table) and hasattr(value, 'columns') and callable(getattr(value, 'to_dict', None)) and callable(getattr(value, 'to_string', None)) and not globals().get('_LARKUP_PRESENTATION_EMITTED', False):
            table('Analysis results', value, columns=list(value.columns))
            return
        formatter = globals().get('_larkup_print_result')
        if callable(formatter):
            formatter(value)
        else:
            print(repr(value))
_larkup_tree = _larkup_ast.parse(_larkup_base64.b64decode(${encodedExpression}), filename='analysis.py', mode='exec')
_larkup_expression_indices = [index for index, node in enumerate(_larkup_tree.body) if isinstance(node, _larkup_ast.Expr) and not (isinstance(node.value, _larkup_ast.Call) and isinstance(node.value.func, _larkup_ast.Name) and node.value.func.id == '_larkup_auto_present')]
_larkup_final_expression = _larkup_expression_indices[-1] if _larkup_expression_indices else -1
for _larkup_index, _larkup_node in enumerate(_larkup_tree.body):
    if isinstance(_larkup_node, _larkup_ast.Expr):
        if _larkup_index == 0 and isinstance(_larkup_node.value, _larkup_ast.Constant) and isinstance(_larkup_node.value.value, str):
            continue
        _larkup_node.value = _larkup_ast.Call(func=_larkup_ast.Name(id='_larkup_display_expression', ctx=_larkup_ast.Load()), args=[_larkup_node.value, _larkup_ast.Constant(value=_larkup_index == _larkup_final_expression)], keywords=[])
_larkup_ast.fix_missing_locations(_larkup_tree)
exec(compile(_larkup_tree, 'analysis.py', 'exec'), globals(), globals())`
    .split('\n')
    .map((line) => indentation + line)
    .join('\n');
}
