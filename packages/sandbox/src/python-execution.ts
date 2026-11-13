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
_larkup_source = _larkup_base64.b64decode(${encodedExpression}).decode('utf-8')
try:
    _larkup_tree = _larkup_ast.parse(_larkup_source, filename='analysis.py', mode='exec')
except SyntaxError as _larkup_original_error:
    import io as _larkup_io, tokenize as _larkup_tokenize
    _larkup_lines = _larkup_source.splitlines(keepends=True)
    _larkup_offsets = [0]
    for _larkup_line in _larkup_lines:
        _larkup_offsets.append(_larkup_offsets[-1] + len(_larkup_line))
    _larkup_protected = set()
    try:
        _larkup_fstring_depth = 0
        for _larkup_token in _larkup_tokenize.generate_tokens(_larkup_io.StringIO(_larkup_source).readline):
            _larkup_kind = _larkup_tokenize.tok_name[_larkup_token.type]
            if _larkup_kind == 'FSTRING_START':
                _larkup_fstring_depth += 1
            if _larkup_token.type in (_larkup_tokenize.STRING, _larkup_tokenize.COMMENT) or _larkup_fstring_depth:
                _larkup_start = _larkup_offsets[_larkup_token.start[0] - 1] + _larkup_token.start[1]
                _larkup_end = _larkup_offsets[_larkup_token.end[0] - 1] + _larkup_token.end[1]
                _larkup_protected.update(range(_larkup_start, _larkup_end))
            if _larkup_kind == 'FSTRING_END':
                _larkup_fstring_depth -= 1
    except (_larkup_tokenize.TokenError, IndentationError):
        raise _larkup_original_error
    _larkup_repaired = []
    _larkup_pos = 0
    while _larkup_pos < len(_larkup_source):
        if _larkup_source[_larkup_pos:_larkup_pos + 2] == chr(92) + 'n' and _larkup_pos not in _larkup_protected:
            _larkup_repaired.append(chr(10))
            _larkup_pos += 2
        else:
            _larkup_repaired.append(_larkup_source[_larkup_pos])
            _larkup_pos += 1
    _larkup_candidate = ''.join(_larkup_repaired)
    if _larkup_candidate == _larkup_source:
        raise _larkup_original_error
    _larkup_tree = _larkup_ast.parse(_larkup_candidate, filename='analysis.py', mode='exec')
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
