from aiogram.fsm.state import State, StatesGroup


class CreateTask(StatesGroup):
    title = State()
    priority = State()
    deadline = State()
